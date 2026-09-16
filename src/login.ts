import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sleep } from "./process.js";

const run = promisify(execFile);

export async function clickLogin(environment: NodeJS.ProcessEnv): Promise<void> {
  let windowId = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const result = await run("xdotool", ["search", "--onlyvisible", "--class", "spotify"], {
        env: environment,
        uid: 1000,
        gid: 1000,
      });
      windowId = result.stdout.trim().split(/\s+/)[0] ?? "";
    } catch {
      windowId = "";
    }
    if (windowId) break;
    await sleep(1000);
  }
  if (!windowId) throw new Error("Could not find the Spotify window");

  await run("xdotool", ["windowactivate", "--sync", windowId], {
    env: environment,
    uid: 1000,
    gid: 1000,
  });
  await sleep(5000);
  await run("xdotool", ["mousemove", "--window", windowId, "210", "343", "click", "1"], {
    env: environment,
    uid: 1000,
    gid: 1000,
  });
}
