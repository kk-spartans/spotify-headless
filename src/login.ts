import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { sleep } from "./process.js";
import { sampleAverage } from "./x11.js";

const run = promisify(execFile);

// Calibrated against Spotify 1.2.95's 839x629 first-run window (see screenshots).
const LOGIN_CLICK_X = "210";
const LOGIN_CLICK_Y = "343";
const LOGIN_WIDTH = 839;
const LOGIN_HEIGHT = 629;
const GEOMETRY_TOLERANCE = 40;

export type ClickOptions = {
  environment: NodeJS.ProcessEnv;
  // File the URL capture handler writes to; used as the success signal.
  capturePath: string;
  // Spotify's user-data-dir parent (session state is wiped on reset).
  cacheDir: string;
  // Kill the client and wipe its session state first, forcing a pristine
  // first-run screen. Only safe while logged out.
  reset: boolean;
};

async function findWindow(
  environment: NodeJS.ProcessEnv,
  attempts: number,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let windowId = "";
    try {
      const result = await run(
        "xdotool",
        ["search", "--onlyvisible", "--class", "spotify"],
        { env: environment, uid: 1000, gid: 1000 },
      );
      windowId = result.stdout.trim().split(/\s+/)[0] ?? "";
    } catch {
      windowId = "";
    }
    if (windowId) return windowId;
    await sleep(1000);
  }
  return "";
}

async function windowSize(
  environment: NodeJS.ProcessEnv,
  windowId: string,
): Promise<[number, number] | null> {
  try {
    const result = await run(
      "xdotool",
      ["getwindowgeometry", "--shell", windowId],
      { env: environment, uid: 1000, gid: 1000 },
    );
    const width = /WIDTH=(\d+)/.exec(result.stdout)?.[1];
    const height = /HEIGHT=(\d+)/.exec(result.stdout)?.[1];
    if (!width || !height) return null;
    return [Number(width), Number(height)];
  } catch {
    return null;
  }
}

// Process handles (parent pid, supervisor-tracked or reparented) are
// unreliable for the CEF client, so reset kills by /proc scan instead.
async function spotifyPids(): Promise<number[]> {
  const pids: number[] = [];
  let entries: string[];
  try {
    entries = await readdir("/proc");
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let command: string;
    try {
      command = await readFile(`/proc/${entry}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (command.includes(".spotify-wrapped")) pids.push(Number(entry));
  }
  return pids;
}

async function resetClient(cacheDir: string): Promise<void> {
  for (const pid of await spotifyPids()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone (or waiting on the supervisor to restart it).
    }
  }
  // Give the supervisor's restart a moment to stay out of the way, then wipe
  // before it gets far: rm here must win the race with the fresh client.
  await sleep(300);
  await rm(`${cacheDir}/spotify`, { recursive: true, force: true });
  await rm(`${cacheDir}/spotify/SingletonCookie`, { force: true });
  await rm(`${cacheDir}/spotify/SingletonLock`, { force: true });
  await rm(`${cacheDir}/spotify/SingletonSocket`, { force: true });
}

async function captureAppeared(path: string, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(500);
  }
  return existsSync(path);
}

export async function clickLogin(options: ClickOptions): Promise<boolean> {
  const { environment, capturePath, cacheDir, reset } = options;
  if (reset) await resetClient(cacheDir);
  const windowId = await findWindow(environment, 40);
  if (!windowId) throw new Error("Could not find the Spotify window");

  const size = await windowSize(environment, windowId);
  if (
    !size ||
    Math.abs(size[0] - LOGIN_WIDTH) > GEOMETRY_TOLERANCE ||
    Math.abs(size[1] - LOGIN_HEIGHT) > GEOMETRY_TOLERANCE
  )
    throw new Error(
      "Spotify is not showing the login screen. If it is already logged in, there is nothing to do.",
    );

  await run("xdotool", ["windowactivate", "--sync", windowId], {
    env: environment,
    uid: 1000,
    gid: 1000,
  });
  // A failed login attempt leaves a red error banner that swallows clicks.
  // Spot its background color and dismiss it via its corner X first.
  const banner = await sampleAverage(
    environment.DISPLAY,
    Number(windowId),
    80,
    100,
    8,
    8,
  );
  if (banner && banner.r > 200 && banner.g < 100 && banner.b < 100) {
    await run(
      "xdotool",
      ["mousemove", "--window", windowId, "800", "115", "click", "1"],
      { env: environment, uid: 1000, gid: 1000 },
    );
    await sleep(2000);
  }
  await sleep(5000);
  await run(
    "xdotool",
    ["mousemove", "--window", windowId, LOGIN_CLICK_X, LOGIN_CLICK_Y, "click", "1"],
    { env: environment, uid: 1000, gid: 1000 },
  );
  // The capture handler firing (file appears) is the success signal the
  // frontend also polls for. No throw here: the caller reports the outcome.
  return captureAppeared(capturePath, 12000);
}
