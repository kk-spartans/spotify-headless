import { spawn, type ChildProcess } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SPOTIFY_GROUP_ID, SPOTIFY_USER_ID } from "./config.js";

// MPEG-TS with AAC, streamed straight out of ffmpeg. This exists because VLC
// cannot play the WebRTC stream and the Ogg/Icecast path buffers too much to
// be pleasant. There is no server-side queue: ffmpeg writes and Node forwards,
// so latency is one encoder frame plus whatever the client chooses to cache.

const DEFAULT_BITRATE = 128;
const MIN_BITRATE = 48;
const MAX_BITRATE = 320;
const MAX_CLIENTS = 8;
// Keep the cache small enough to feel live; VLC's own default is 1000 ms.
const PLAYLIST_CACHING = 500;
const START_TIMEOUT = 15000;

export type LiveFormat = "stream" | "playlist";

export type LiveRequest = {
  bitrate: number;
  format: LiveFormat;
};

export function clampLiveBitrate(value: number): number {
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, Math.trunc(value)));
}

export function parseLivePath(pathname: string): LiveRequest | null {
  const match = /^\/spotify(?:-(\d+))?\.(ts|m3u)$/.exec(pathname);
  if (!match) return null;
  const requested = match[1] === undefined ? DEFAULT_BITRATE : Number(match[1]);
  if (!Number.isSafeInteger(requested)) return null;
  return {
    bitrate: clampLiveBitrate(requested),
    format: match[2] === "m3u" ? "playlist" : "stream",
  };
}

export class LiveStreamManager {
  private clients = 0;
  private readonly processes = new Set<ChildProcess>();

  constructor(private readonly audioEnvironment: NodeJS.ProcessEnv) {}

  serve(
    request: IncomingMessage,
    response: ServerResponse,
    live: LiveRequest,
    origin: string,
  ): void {
    if (live.format === "playlist") {
      this.sendPlaylist(response, live.bitrate, origin);
      return;
    }
    if (request.method === "HEAD") {
      response.writeHead(200, { ...STREAM_HEADERS }).end();
      return;
    }
    if (this.clients >= MAX_CLIENTS) {
      response
        .writeHead(503, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "close",
        })
        .end("Too many listeners");
      return;
    }
    this.stream(response, live.bitrate);
  }

  close(): void {
    for (const child of this.processes) child.kill("SIGTERM");
    this.processes.clear();
  }

  private sendPlaylist(
    response: ServerResponse,
    bitrate: number,
    origin: string,
  ): void {
    // EXTVLCOPT lines are honoured by VLC (including VLC for Android): they cut
    // the default one second of network buffering and ask VLC to reconnect on
    // its own if the connection drops.
    const content = `#EXTM3U
#EXTINF:-1,Spotify Headless
#EXTVLCOPT:network-caching=${PLAYLIST_CACHING}
#EXTVLCOPT:http-reconnect
${origin}/spotify-${bitrate}.ts
`;
    response
      .writeHead(200, {
        "Content-Type": "audio/x-mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": content.length,
      })
      .end(content);
  }

  private stream(response: ServerResponse, bitrate: number): void {
    this.clients += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.clients -= 1;
    };

    const child = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-thread_queue_size",
        "32",
        "-f",
        "pulse",
        "-fragment_size",
        "960",
        "-i",
        "spotify_stream.monitor",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        `${bitrate}k`,
        "-profile:a",
        "aac_low",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-muxdelay",
        "0",
        "-muxpreload",
        "0",
        "-flush_packets",
        "1",
        "-f",
        "mpegts",
        "pipe:1",
      ],
      {
        env: this.audioEnvironment,
        uid: SPOTIFY_USER_ID,
        gid: SPOTIFY_GROUP_ID,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.processes.add(child);

    let started = false;
    let failure = "";
    let finished = false;

    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 2000);
    };

    const finish = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(startTimer);
      if (error) {
        if (!response.headersSent) {
          response
            .writeHead(503, {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              Connection: "close",
            })
            .end(error);
        } else {
          response.destroy();
        }
      } else if (!response.writableEnded) {
        response.end();
      }
      release();
      stop();
    };

    const startTimer = setTimeout(() => {
      if (started || finished) return;
      finish("Timed out starting the live stream");
    }, START_TIMEOUT);

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      failure = text.trim().split("\n").at(-1) ?? failure;
      process.stderr.write(`[live] ${text}`);
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (finished) return;
      if (!started) {
        started = true;
        clearTimeout(startTimer);
        response.writeHead(200, { ...STREAM_HEADERS });
        response.socket?.setNoDelay?.(true);
      }
      if (!response.write(chunk)) child.stdout?.pause();
    });

    response.on("drain", () => child.stdout?.resume());

    child.stdout?.on("end", () => {
      if (!started) {
        finish(`Could not start the live stream${failure ? `: ${failure}` : ""}`);
        return;
      }
      finish();
    });

    child.once("error", (error: Error) => {
      this.processes.delete(child);
      finish(`Could not start ffmpeg: ${error.message}`);
    });

    child.once("exit", (code: number | null, signal: string | null) => {
      this.processes.delete(child);
      if (!started) {
        finish(
          `Could not start the live stream${failure ? `: ${failure}` : ` (ffmpeg exited ${code ?? signal})`}`,
        );
        return;
      }
      finish();
    });

    response.once("close", () => {
      finished = true;
      clearTimeout(startTimer);
      release();
      stop();
    });
  }
}

const STREAM_HEADERS = {
  "Content-Type": "video/mp2t",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  Connection: "close",
};
