declare const process: {
  env: NodeJS.ProcessEnv;
  argv: string[];
  pid: number;
  stdout: { write(value: unknown): void };
  stderr: { write(value: unknown): void };
  exitCode?: number;
  once(event: string, listener: (...args: any[]) => void): void;
};

declare const Buffer: {
  from(value: unknown): any;
  concat(values: any[]): any;
};
type Buffer = any;

declare namespace NodeJS {
  type ProcessEnv = Record<string, string | undefined>;
  type Timeout = ReturnType<typeof setTimeout>;
}

declare module "node:child_process" {
  export const spawn: any;
  export const execFile: any;
  export type ChildProcess = any;
}

declare module "node:fs" {
  export const existsSync: any;
}

declare module "node:fs/promises" {
  export const access: any;
  export const chmod: any;
  export const chown: any;
  export const lstat: any;
  export const mkdir: any;
  export const readdir: any;
  export const rename: any;
  export const rm: any;
  export const unlink: any;
  export const writeFile: any;
  export const readFile: any;
}

declare module "node:http" {
  export const createServer: any;
  export const request: any;
  export type IncomingMessage = any;
  export type Server = any;
  export type ServerResponse = any;
  export type ClientRequest = any;
}

declare module "node:net" {
  export const createConnection: any;
  export const connect: any;
  export type Socket = any;
}

declare module "node:os" {
  export const homedir: any;
}

declare module "node:path" {
  export const dirname: any;
}

declare module "node:util" {
  export const promisify: any;
}
