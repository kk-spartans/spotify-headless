import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function spawnProcess(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  options: { uid?: number; gid?: number } = {},
): ChildProcess {
  const child = spawn(command, args, {
    env: environment,
    uid: options.uid,
    gid: options.gid,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${command}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${command}] ${chunk}`));
  return child;
}

export class ManagedProcess {
  private child: ChildProcess | undefined;
  private stopping = false;
  private restarting = false;

  constructor(
    private readonly name: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly environment: NodeJS.ProcessEnv,
    private readonly options: { uid?: number; gid?: number } = {},
  ) {}

  start(restart = true): void {
    if (this.child && this.child.exitCode === null) return;
    this.stopping = false;
    this.child = spawnProcess(this.command, this.args, this.environment, this.options);
    this.child.on("exit", (code, signal) => {
      this.child = undefined;
      if (this.stopping || !restart || this.restarting) return;
      this.restarting = true;
      setTimeout(() => {
        this.restarting = false;
        if (!this.stopping) {
          console.error(`[${this.name}] exited (${code ?? signal}), restarting`);
          this.start(true);
        }
      }, 1000);
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.child && this.child.exitCode === null) this.child.kill("SIGTERM");
  }
}

export async function waitForFile(path: string, timeout = 30000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

export async function waitForPort(
  host: string,
  port: number,
  timeout = 30000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      const finish = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (connected) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

export async function waitForCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeout = 30000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(command, args, {
        env: environment,
        uid: 1000,
        gid: 1000,
        stdio: "ignore",
        shell: false,
      });
      child.once("exit", (code) => resolve(code ?? 1));
      child.once("error", () => resolve(1));
    });
    if (exitCode === 0) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${command}`);
}
