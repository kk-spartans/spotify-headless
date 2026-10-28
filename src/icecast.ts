import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { chown, unlink } from "node:fs/promises";
import type { Config } from "./config.js";
import { clampBitrate } from "./config.js";
import { ManagedProcess, sleep, waitForPort } from "./process.js";
import { writeIcecastConfig } from "./config-files.js";

type StreamState = {
  bitrate: number;
  clients: number;
  process: ManagedProcess;
  idleTimer?: NodeJS.Timeout;
};

// Headers are ours, not icecast's: forwarding handshake headers such as
// Connection/Transfer-Encoding makes Node emit a second, conflicting set.
const MOUNT_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  Connection: "close",
  "Icy-Name": "Spotify Headless",
  "Icy-Pub": "0",
  "Icy-MetaData": "0",
};

export class IcecastManager {
  private server?: ManagedProcess;
  private readonly streams = new Map<number, StreamState>();
  private starting?: Promise<void>;
  private configPath?: string;

  constructor(
    private readonly config: Config,
    private readonly audioEnvironment: NodeJS.ProcessEnv,
  ) {}

  async proxy(
    requestPath: string,
    response: ServerResponse,
    method = "GET",
  ): Promise<void> {
    const match = /^\/spotify-(\d+)\.opus$/.exec(requestPath);
    if (!match) {
      response
        .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Not found");
      return;
    }

    const requestedBitrate = Number(match[1]);
    if (!Number.isSafeInteger(requestedBitrate)) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid bitrate");
      return;
    }
    const bitrate = clampBitrate(requestedBitrate);

    // Players (and every browser preflight) probe with HEAD before opening a
    // stream. Answering 404 here made on-demand mounts look broken, so report
    // the mount without starting the encoder.
    if (method === "HEAD") {
      response.writeHead(200, { ...MOUNT_HEADERS, "Content-Type": "audio/ogg" }).end();
      return;
    }

    let state: StreamState;
    let upstream: IncomingMessage;
    try {
      ({ state, upstream } = await this.open(bitrate));
    } catch (error) {
      response
        .writeHead(503, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "close",
        })
        .end(
          `Stream unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      return;
    }

    state.clients += 1;
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = undefined;
    }

    response.writeHead(200, {
      ...MOUNT_HEADERS,
      "Content-Type": upstream.headers["content-type"] ?? "audio/ogg",
    });
    response.socket?.setNoDelay?.(true);

    const release = () => {
      if (state.clients > 0) state.clients -= 1;
      if (state.clients === 0) this.scheduleIdleStop(state);
    };
    upstream.once("error", () => {
      if (!response.writableEnded) response.destroy();
      release();
    });
    upstream.pipe(response);
    response.once("close", () => {
      upstream.destroy();
      release();
    });
  }

  // The encoder and the mount can disappear under us (source timeout, ffmpeg
  // restart, icecast restarting between requests). Retry the whole open before
  // handing a 404/503 to the player.
  private async open(
    bitrate: number,
  ): Promise<{ state: StreamState; upstream: IncomingMessage }> {
    let lastError = new Error("Icecast did not start the stream");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let state: StreamState | undefined;
      try {
        state = await this.ensureStream(bitrate);
        const upstream = await this.connectMount(bitrate);
        if ((upstream.statusCode ?? 0) === 200) return { state, upstream };
        lastError = new Error(
          `Icecast responded with ${upstream.statusCode ?? "no status"}`,
        );
        upstream.resume();
        upstream.destroy();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (state && state.clients === 0) {
        state.process.stop();
        this.streams.delete(state.bitrate);
      }
      await sleep(250);
    }
    throw lastError;
  }

  private connectMount(bitrate: number): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const upstream = request(
        {
          host: "127.0.0.1",
          port: 8000,
          path: `/spotify-${bitrate}.opus`,
          method: "GET",
          headers: {
            Host: "127.0.0.1:8000",
            "Cache-Control": "no-cache",
            "Icy-MetaData": "0",
          },
        },
        (sourceResponse) => {
          upstream.setTimeout(0);
          resolve(sourceResponse);
        },
      );
      upstream.setTimeout(5000, () =>
        upstream.destroy(new Error("Icecast did not respond")),
      );
      upstream.once("error", reject);
      upstream.end();
    });
  }

  async close(): Promise<void> {
    for (const state of this.streams.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.process.stop();
    }
    this.streams.clear();
    this.server?.stop();
    this.server = undefined;
    await unlink(`${this.config.runtimeDir}/icecast.xml`).catch(() => undefined);
  }

  private async ensureStream(bitrate: number): Promise<StreamState> {
    const existing = this.streams.get(bitrate);
    if (existing) return existing;
    await this.ensureServer();
    const mount = `spotify-${bitrate}.opus`;
    const process = new ManagedProcess(
      `ffmpeg-${bitrate}`,
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-thread_queue_size",
        "64",
        "-f",
        "pulse",
        "-fragment_size",
        "960",
        "-i",
        "spotify_stream.monitor",
        "-vn",
        "-c:a",
        "libopus",
        "-b:a",
        `${bitrate}k`,
        "-vbr",
        "off",
        "-application",
        "lowdelay",
        "-frame_duration",
        "10",
        "-flush_packets",
        "1",
        "-page_duration",
        "20000",
        "-content_type",
        "audio/ogg",
        "-f",
        "ogg",
        `icecast://source:${this.config.sourcePassword}@127.0.0.1:8000/${mount}`,
      ],
      this.audioEnvironment,
      { uid: 1000, gid: 1000 },
    );
    process.start(true);
    const state = { bitrate, clients: 0, process };
    this.streams.set(bitrate, state);
    try {
      await this.waitForMount(bitrate);
    } catch (error) {
      state.process.stop();
      this.streams.delete(bitrate);
      throw error;
    }
    return state;
  }

  private async ensureServer(): Promise<void> {
    if (this.server) return this.starting;
    this.starting = (async () => {
      this.configPath = await writeIcecastConfig(this.config);
      await chown(this.configPath, 1000, 1000);
      this.server = new ManagedProcess(
        "icecast",
        "icecast",
        ["-c", this.configPath],
        this.audioEnvironment,
        { uid: 1000, gid: 1000 },
      );
      this.server.start(false);
      await waitForPort("127.0.0.1", 8000);
    })();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async waitForMount(bitrate: number): Promise<void> {
    const path = `/spotify-${bitrate}.opus`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const available = await new Promise<boolean>((resolve) => {
        const probe = request({ host: "127.0.0.1", port: 8000, path, method: "GET" }, (source) => {
          resolve(source.statusCode === 200);
          source.destroy();
        });
        probe.once("error", () => resolve(false));
        probe.setTimeout(500, () => {
          probe.destroy();
          resolve(false);
        });
        probe.end();
      });
      if (available) return;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${path}`);
  }

  private scheduleIdleStop(state: StreamState): void {
    state.idleTimer = setTimeout(() => {
      if (state.clients > 0) return;
      state.process.stop();
      this.streams.delete(state.bitrate);
      if (this.streams.size === 0) {
        this.server?.stop();
        this.server = undefined;
      }
    }, 10000);
  }
}
