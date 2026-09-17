import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import type { Config } from "./config.js";

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function prepareFiles(config: Config): Promise<void> {
  await Promise.all([
    mkdir(config.homeDir, { recursive: true }),
    mkdir(config.cacheDir, { recursive: true }),
    mkdir(`${config.configDir}/applications`, { recursive: true }),
    mkdir(`${config.dataHome}/applications`, { recursive: true }),
    mkdir(config.runtimeDir, { recursive: true }),
    mkdir(`${config.dataDir}/logs`, { recursive: true }),
    mkdir("/tmp/.X11-unix", { recursive: true }),
    mkdir(`${config.runtimeDir}/pulse`, { recursive: true }),
  ]);

  await Promise.all([chmod(config.runtimeDir, 0o700), chmod("/tmp/.X11-unix", 0o1777)]);
  await Promise.all([
    rm(`${config.runtimeDir}/auth-url.txt`, { force: true }),
    rm(`${config.cacheDir}/spotify/SingletonCookie`, { force: true }),
    rm(`${config.cacheDir}/spotify/SingletonLock`, { force: true }),
    rm(`${config.cacheDir}/spotify/SingletonSocket`, { force: true }),
    rm("/tmp/.X99-lock", { force: true }),
    rm("/tmp/.X11-unix/X99", { force: true }),
    rm(`${config.runtimeDir}/dbus.sock`, { force: true }),
  ]);

  const desktopFile = `[Desktop Entry]
Type=Application
Name=Spotify authorization URL capture
Exec=/opt/runtime/bin/node /opt/runtime/lib/spotify-headless/dist/auth-capture.js %u
NoDisplay=true
Terminal=false
MimeType=x-scheme-handler/http;x-scheme-handler/https;
`;
  const mimeApps = `[Default Applications]
x-scheme-handler/http=spotify-auth-capture.desktop
x-scheme-handler/https=spotify-auth-capture.desktop

[Added Associations]
x-scheme-handler/http=spotify-auth-capture.desktop;
x-scheme-handler/https=spotify-auth-capture.desktop;
`;
  await writeFile(`${config.dataHome}/applications/spotify-auth-capture.desktop`, desktopFile);
  await writeFile(`${config.configDir}/mimeapps.list`, mimeApps);
}

export async function writePulseConfig(config: Config): Promise<string> {
  const path = `${config.runtimeDir}/pulse/pulse.conf`;
  const content = `load-module module-native-protocol-unix socket=${config.runtimeDir}/pulse/native auth-anonymous=1
load-module module-null-sink sink_name=spotify_stream rate=48000 channels=2 sink_properties=device.description=Spotify_Stream
set-default-sink spotify_stream
set-default-source spotify_stream.monitor
`;
  await writeFile(path, content, { mode: 0o644 });
  return path;
}

export async function writeMediaMtxConfig(config: Config): Promise<string> {
  const path = `${config.runtimeDir}/mediamtx.yml`;
  const content = `logLevel: info
logDestinations: [stdout]
rtsp: true
rtspAddress: :8554
rtmp: false
hls: false
srt: false
webrtc: true
webrtcAddress: :8889
webrtcLocalUDPAddress: :8189
webrtcAdditionalHosts:
  - ${JSON.stringify(config.webrtcAdditionalHost)}
  - ${JSON.stringify(config.webrtcTailscaleHost)}
paths:
  spotify:
    source: publisher
`;
  await writeFile(path, content, { mode: 0o600 });
  return path;
}

export async function writeIcecastConfig(config: Config): Promise<string> {
  const path = `${config.runtimeDir}/icecast.xml`;
  const mounts = Array.from({ length: 133 }, (_, index) => {
    const bitrate = index + 60;
    return `
  <mount>
    <mount-name>/spotify-${bitrate}.opus</mount-name>
    <username>source</username>
    <password>${xml(config.sourcePassword)}</password>
    <public>0</public>
    <bitrate>${bitrate}</bitrate>
    <type>application/ogg</type>
    <subtype>opus</subtype>
    <burst-size>4096</burst-size>
  </mount>`;
  }).join("");
  const content = `<?xml version="1.0"?>
<icecast>
  <location>LAN</location>
  <admin>local@spotify-headless</admin>
  <hostname>spotify-headless</hostname>
   <limits>
    <clients>1000</clients>
    <sources>133</sources>
    <queue-size>65536</queue-size>
    <source-timeout>10</source-timeout>
    <burst-size>4096</burst-size>
  </limits>
  <authentication>
    <source-password>${xml(config.sourcePassword)}</source-password>
    <admin-user>admin</admin-user>
    <admin-password>${xml(config.adminPassword)}</admin-password>
  </authentication>
  <listen-socket>
    <port>8000</port>
    <bind-address>127.0.0.1</bind-address>
  </listen-socket>${mounts}
  <paths>
    <logdir>${xml(config.dataDir)}/logs</logdir>
    <adminroot>/opt/runtime/share/icecast/admin</adminroot>
    <webroot>/opt/runtime/share/icecast/web</webroot>
  </paths>
  <logging>
    <accesslog>icecast-access.log</accesslog>
    <errorlog>icecast-error.log</errorlog>
    <loglevel>2</loglevel>
    <logsize>10000</logsize>
  </logging>
  <security><chroot>0</chroot></security>
</icecast>
`;
  await writeFile(path, content, { mode: 0o600 });
  return path;
}
