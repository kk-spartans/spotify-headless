import { createConnection } from "node:net";

// Minimal X11 client: reads a small tile of pixels. Used to spot UI states
// (e.g. the red error banner) that blind xdotool clicks cannot see.
export type Rgb = { r: number; g: number; b: number };

function socketPath(display: string | undefined): string {
  const match = /:(\d+)/.exec(display ?? "");
  return `/tmp/.X11-unix/X${match ? match[1] : "99"}`;
}

export async function sampleAverage(
  display: string | undefined,
  drawable: number,
  x: number,
  y: number,
  width: number,
  height: number,
  timeout = 8000,
): Promise<Rgb | null> {
  try {
    return await withTimeout(sample(display, drawable, x, y, width, height), timeout);
  } catch {
    return null;
  }
}

function withTimeout<T>(work: Promise<T>, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("X11 timeout")), timeout);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function sample(
  display: string | undefined,
  drawable: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<Rgb> {
  const sock: any = createConnection(socketPath(display));
  await new Promise<void>((resolve, reject) => {
    sock.once("connect", resolve);
    sock.once("error", reject);
  });
  try {
    let stash: any = Buffer.alloc(0);
    const waiters: { n: number; resolve: (value: any) => void }[] = [];
    const pump = () => {
      while (waiters.length && stash.length >= waiters[0].n) {
        const next = waiters.shift();
        if (!next) break;
        const out = stash.subarray(0, next.n);
        stash = stash.subarray(next.n);
        next.resolve(out);
      }
    };
    sock.on("data", (chunk: any) => {
      stash = Buffer.concat([stash, chunk]);
      pump();
    });
    const read = (n: number): Promise<any> =>
      new Promise((resolve) => {
        waiters.push({ n, resolve });
        pump();
      });

    // Setup: little-endian, 11.0, no auth. The setup body is discarded;
    // drawables are addressed by id (found via xdotool), never parsed here.
    const setup: any = Buffer.alloc(12);
    setup[0] = 0x6c;
    setup.writeUInt16LE(11, 2);
    sock.write(setup);
    const head: any = await read(8);
    if (head[0] !== 1) throw new Error("X11 setup failed");
    await read(head.readUInt16LE(6) * 4);

    // GetImage (opcode 73), ZPixmap, full plane mask.
    const request: any = Buffer.alloc(20);
    request[0] = 73;
    request[1] = 2;
    request.writeUInt16LE(5, 2);
    request.writeUInt32LE(drawable, 4);
    request.writeUInt16LE(x, 8);
    request.writeUInt16LE(y, 10);
    request.writeUInt16LE(width, 12);
    request.writeUInt16LE(height, 14);
    request.writeUInt32LE(0xffffff, 16);
    sock.write(request);
    const reply: any = await read(32);
    if (reply[0] !== 1) throw new Error("GetImage failed");
    const data: any = await read(reply.readUInt32LE(4) * 4);

    // 32bpp little-endian B,G,R,X (standard TrueColor).
    let r = 0,
      g = 0,
      b = 0;
    const count = width * height;
    for (let i = 0; i < count; i += 1) {
      const v = data.readUInt32LE(i * 4);
      r += (v >>> 16) & 0xff;
      g += (v >>> 8) & 0xff;
      b += v & 0xff;
    }
    return { r: r / count, g: g / count, b: b / count };
  } finally {
    try {
      sock.end();
    } catch {
      // Ignore teardown errors.
    }
  }
}
