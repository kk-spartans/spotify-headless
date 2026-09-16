import { homedir } from "node:os";

export const MIN_BITRATE = 60;
export const MAX_BITRATE = 192;
export const SPOTIFY_USER_ID = 1000;
export const SPOTIFY_GROUP_ID = 1000;

export type Config = {
  adminPassword: string;
  sourcePassword: string;
  deviceName: string;
  autoLoginClick: boolean;
  webrtcAdditionalHost: string;
  webrtcTailscaleHost: string;
  dataDir: string;
  homeDir: string;
  cacheDir: string;
  configDir: string;
  dataHome: string;
  runtimeDir: string;
  display: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name] ?? String(fallback);
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function validateSecret(name: string, value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return value;
}

function validateHost(name: string, value: string): string {
  if (!/^[a-zA-Z0-9.:[\]-]+$/.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return value;
}

export function loadConfig(): Config {
  const dataDir = process.env.DATA_DIR ?? "/data";
  return {
    adminPassword: validateSecret("ICECAST_ADMIN_PASSWORD", required("ICECAST_ADMIN_PASSWORD")),
    sourcePassword: validateSecret("ICECAST_SOURCE_PASSWORD", required("ICECAST_SOURCE_PASSWORD")),
    deviceName: required("SPOTIFY_DEVICE_NAME"),
    autoLoginClick: flag("AUTO_LOGIN_CLICK", true),
    webrtcAdditionalHost: validateHost(
      "WEBRTC_ADDITIONAL_HOST",
      required("WEBRTC_ADDITIONAL_HOST"),
    ),
    webrtcTailscaleHost: validateHost(
      "WEBRTC_TAILSCALE_HOST",
      required("WEBRTC_TAILSCALE_HOST"),
    ),
    dataDir,
    homeDir: process.env.HOME ?? `${dataDir}/home`,
    cacheDir: process.env.XDG_CACHE_HOME ?? `${dataDir}/cache`,
    configDir: process.env.XDG_CONFIG_HOME ?? `${dataDir}/config`,
    dataHome: process.env.XDG_DATA_HOME ?? `${dataDir}/share`,
    runtimeDir: process.env.XDG_RUNTIME_DIR ?? `${dataDir}/run`,
    display: process.env.DISPLAY ?? ":99",
  };
}

export function clampBitrate(value: number): number {
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, Math.trunc(value)));
}

export function authUrlPath(config: Config): string {
  return `${config.runtimeDir}/auth-url.txt`;
}

export function spotifyHome(config: Config): string {
  return config.homeDir || homedir();
}
