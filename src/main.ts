import { chown, lstat, mkdir, readdir } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { authUrlPath } from "./config.js";
import { prepareFiles, writeMediaMtxConfig, writePulseConfig } from "./config-files.js";
import { IcecastManager } from "./icecast.js";
import { clickLogin } from "./login.js";
import { ManagedProcess, sleep, waitForCommand, waitForFile, waitForPort } from "./process.js";
import { createWebServer } from "./web.js";
import { SPOTIFY_GROUP_ID, SPOTIFY_USER_ID } from "./config.js";

const config = loadConfig();
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  DISPLAY: config.display,
  HOME: config.homeDir,
  XDG_CACHE_HOME: config.cacheDir,
  XDG_CONFIG_HOME: config.configDir,
  XDG_DATA_HOME: config.dataHome,
  XDG_RUNTIME_DIR: config.runtimeDir,
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${config.runtimeDir}/dbus.sock`,
  PULSE_SERVER: `unix:${config.runtimeDir}/pulse/native`,
  PULSE_SINK: "spotify_stream",
  XKB_CONFIG_ROOT: "/opt/runtime/share/X11/xkb",
};

const processes: ManagedProcess[] = [];
let shuttingDown = false;
let ready = false;

async function start(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  await prepareFiles(config);
  await chownTree(config.dataDir);
  const childEnvironment = {
    ...environment,
    FONTCONFIG_FILE: await findStoreFile("fontconfig", "/etc/fonts/fonts.conf"),
  };

  const dbus = new ManagedProcess("dbus", "dbus-daemon", ["--nofork", "--config-file=/opt/runtime/share/dbus-1/session.conf", `--address=unix:path=${config.runtimeDir}/dbus.sock`], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  const xvfb = new ManagedProcess("xvfb", "Xvfb", [config.display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-noreset"], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  processes.push(dbus, xvfb);
  dbus.start(true);
  xvfb.start(true);
  await waitForFile(`${config.runtimeDir}/dbus.sock`);
  await waitForFile("/tmp/.X11-unix/X99");

  const openbox = new ManagedProcess("openbox", "openbox", [], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  const pulseConfig = await writePulseConfig(config);
  await chown(pulseConfig, SPOTIFY_USER_ID, SPOTIFY_GROUP_ID);
  const pulse = new ManagedProcess("pulseaudio", "pulseaudio", ["--daemonize=no", "--use-pid-file=false", "--exit-idle-time=-1", `--file=${pulseConfig}`], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  const mediamtxConfig = await writeMediaMtxConfig(config);
  await chown(mediamtxConfig, SPOTIFY_USER_ID, SPOTIFY_GROUP_ID);
  const mediamtx = new ManagedProcess("mediamtx", "mediamtx", [mediamtxConfig], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  processes.push(openbox, pulse, mediamtx);
  openbox.start(true);
  pulse.start(true);
  await waitForCommand("pactl", ["info"], childEnvironment);
  mediamtx.start(true);
  await waitForPort("127.0.0.1", 8889);

  const webrtc = new ManagedProcess("webrtc-audio", "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "warning", "-thread_queue_size", "64", "-f", "pulse", "-fragment_size", "960", "-i", "spotify_stream.monitor", "-vn", "-c:a", "libopus", "-b:a", "96k", "-vbr", "off", "-application", "lowdelay", "-frame_duration", "10", "-ar", "48000", "-ac", "2", "-rtsp_transport", "tcp", "-f", "rtsp", "rtsp://127.0.0.1:8554/spotify"], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  const spotify = new ManagedProcess("spotify", "spotify", ["--disable-gpu", "--no-sandbox", "--password-store=basic", `--device-name=${config.deviceName}`], childEnvironment, { uid: SPOTIFY_USER_ID, gid: SPOTIFY_GROUP_ID });
  processes.push(webrtc, spotify);
  webrtc.start(true);
  spotify.start(true);

  const icecast = new IcecastManager(config, childEnvironment);
  const web = createWebServer({ config, icecast, environment: childEnvironment, ready: () => ready });
  web.listen(8080, "0.0.0.0");
  await waitForPort("127.0.0.1", 8080);
  ready = true;

  // A delivered callback means a live session: never auto-click (or reset)
  // over it. The prefs check is kept for older installs.
  const loggedIn =
    (await fileExists(`${config.runtimeDir}/logged-in`)) ||
    (await fileExists(`${config.configDir}/spotify/prefs`));
  if (config.autoLoginClick && !loggedIn) {
    await sleep(5000);
    clickLogin({
      environment: childEnvironment,
      capturePath: authUrlPath(config),
      cacheDir: config.cacheDir,
      reset: false,
    }).catch((error) => console.error(`[login] ${error.message}`));
  }

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    web.close();
    await icecast.close();
    for (const process of processes.reverse()) process.stop();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

async function fileExists(path: string): Promise<boolean> {
  try { await import("node:fs/promises").then(({ access }) => access(path)); return true; } catch { return false; }
}

async function chownTree(path: string): Promise<void> {
  await chown(path, SPOTIFY_USER_ID, SPOTIFY_GROUP_ID).catch(() => undefined);
  const stat = await lstat(path).catch(() => undefined);
  if (!stat?.isDirectory()) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    await chownTree(`${path}/${entry.name}`);
  }
}

async function findStoreFile(fragment: string, suffix: string): Promise<string> {
  for (const entry of await readdir("/nix/store")) {
    if (!entry.includes(fragment)) continue;
    const candidate = `/nix/store/${entry}${suffix}`;
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(`Could not find ${fragment}${suffix} in /nix/store`);
}

await start();
