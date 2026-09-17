import { request, type ClientRequest, type IncomingMessage, type ServerResponse } from "node:http";
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

export class IcecastManager {
  private server?: ManagedProcess;
  private readonly streams = new Map<number, StreamState>();
  private starting?: Promise<void>;
  private configPath?: string;

  constructor(
    private readonly config: Config,
    private readonly audioEnvironment: NodeJS.ProcessEnv,
  ) {}

  async proxy(requestPath: string, response: ServerResponse): Promise<void> {
    const match = /^\/spotify-(\d+)\.opus$/.exec(requestPath);
    if (!match) {
      response.writeHead(404).end();
      return;
    }

    const requestedBitrate = Number(match[1]);
    if (!Number.isSafeInteger(requestedBitrate)) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid bitrate");
      return;
    }
    const bitrate = clampBitrate(requestedBitrate);
    const state = await this.ensureStream(bitrate);
    state.clients += 1;
    if (state.idleTimer) clearTimeout(state.idleTimer);

    const upstream = request({
      host: "127.0.0.1",
      port: 8000,
      path: `/spotify-${bitrate}.opus`,
      method: "GET",
      headers: { Host: "127.0.0.1:8000", "Cache-Control": "no-cache" },
    }, (sourceResponse) => {
      response.writeHead(sourceResponse.statusCode ?? 502, sourceResponse.headers);
      sourceResponse.pipe(response);
    });
    const release = () => {
      if (state.clients > 0) state.clients -= 1;
      if (state.clients === 0) this.scheduleIdleStop(state);
    };
    upstream.once("error", (error) => {
      if (!response.headersSent) response.writeHead(502);
      response.end(`Icecast unavailable: ${error.message}`);
      release();
    });
    response.once("close", () => {
      upstream.destroy();
      release();
    });
    upstream.end();
  }

  async close(): Promise<void> {
    for (const state of this.streams.values()) state.process.stop();
    this.streams.clear();
    this.server?.stop();
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
