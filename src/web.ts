import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect as connectSocket } from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import type { Config } from "./config.js";
import { authUrlPath } from "./config.js";
import { IcecastManager } from "./icecast.js";
import { clickLogin } from "./login.js";

type RuntimeApi = {
  config: Config;
  icecast: IcecastManager;
  environment: NodeJS.ProcessEnv;
  ready: () => boolean;
};

function rootPage(): string {
  const authSection = `<section id="auth-section" hidden>
        <p class="message" id="auth-status">Spotify login URL captured. Open it in a new tab to finish logging in, then paste the callback URL below.</p>
        <a class="link" id="open-auth" target="_blank" rel="noopener noreferrer">Log in to Spotify</a>
      </section>
      <form id="callback-form" hidden>
        <label for="callback">Spotify callback URL</label>
        <textarea id="callback" name="callback" required placeholder="http://127.0.0.1:4381/login?..." spellcheck="false" autocomplete="off" aria-label="Spotify callback URL"></textarea>
        <button class="secondary" type="submit" id="send-callback">Send callback</button>
      </form>
      <p class="message" id="callback-message" role="status" aria-live="polite"></p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify Headless</title><style>
:root{color-scheme:dark;--ink:#f4f7f5;--muted:#a6b4ae;--surface:#13211c;--surface-2:#1b2d26;--line:#2c463a;--accent:#b7f36b;--accent-ink:#10200f;--danger:#ff8e8e}
*{box-sizing:border-box}body{margin:0;background:#0d1512;color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{min-height:100svh;display:grid;place-items:center;padding:28px 18px;background:radial-gradient(circle at 80% 10%,#234532 0,transparent 35%),#0d1512}.shell{width:min(100%,620px)}.primary,.secondary,.link{border:0;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;transition:transform 180ms ease,background 180ms ease,box-shadow 180ms ease}.primary{display:block;width:100%;padding:14px 20px;background:var(--accent);color:var(--accent-ink);box-shadow:0 10px 30px #b7f36b22}.secondary{padding:11px 16px;background:var(--surface-2);color:var(--ink);border:1px solid var(--line)}.link{display:inline-flex;padding:11px 2px;background:transparent;color:var(--accent);text-decoration:none}.primary:hover,.secondary:hover,.link:hover{transform:translateY(-2px)}.primary:focus-visible,.secondary:focus-visible,.link:focus-visible,textarea:focus-visible{outline:3px solid #fff;outline-offset:3px}.primary:disabled{cursor:wait;opacity:.65;transform:none}.message{margin:14px 0 0;color:var(--muted)}#callback-message:empty{display:none}textarea{display:block;width:100%;min-height:78px;margin:0 0 18px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#0a100e;color:var(--ink);font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
[hidden]{display:none!important}.secondary:disabled{cursor:wait;opacity:.65;transform:none}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important}}
</style></head><body><main><div class="shell"><button class="primary" type="button" id="login">Click Log in</button>${authSection}</div></main><script>
const message = document.querySelector('#callback-message');
const login = document.querySelector('#login');
const authSection = document.querySelector('#auth-section');
const openAuth = document.querySelector('#open-auth');
const callback = document.querySelector('#callback');
const sendCallback = document.querySelector('#send-callback');
function showMessage(text, error = false) {
  message.textContent = text;
  message.style.color = error ? 'var(--danger)' : '';
}
async function requestJson(path, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { ...options, cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request timed out. Please try again.');
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('Could not reach Spotify Headless. Check the connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
login.addEventListener('click', async () => {
  if (login.disabled) return;
  login.disabled = true;
  authSection.hidden = true;
  openAuth.removeAttribute('href');
  callback.form.hidden = true;
  callback.value = '';
  showMessage('');
  // No popups or auto-redirects: the captured URL is shown as a plain link
  // below, which the user opens themselves. Popup blockers can't break this.
  try {
    showMessage('Clicking Log in inside Spotify — waiting for the authorization URL…');
    const attempt = await requestJson('/api/login', { method: 'POST' }, 90000);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const data = await requestJson('/api/login?attempt=' + encodeURIComponent(attempt.id));
      if (data.url) {
        const url = new URL(data.url);
        if (url.protocol !== 'https:' || url.hostname !== 'accounts.spotify.com' || url.port || url.username || url.password) throw new Error('Spotify returned an invalid authorization URL. Try logging in again.');
        openAuth.href = url.href;
        authSection.hidden = false;
        callback.form.hidden = false;
        showMessage('Login URL captured. Open the link above to finish logging in to Spotify, then paste the callback URL below.');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw new Error('No authorization URL was captured. Click Log in again.');
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    login.disabled = false;
  }
});
callback.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sendCallback.disabled) return;
  const value = callback.value.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '4381' || url.pathname !== '/login' || !url.search || url.username || url.password || url.hash) throw new Error();
  } catch {
    showMessage('Paste the complete http://127.0.0.1:4381/login?... URL from the Spotify tab.', true);
    callback.focus();
    return;
  }
  sendCallback.disabled = true;
  login.disabled = true;
  showMessage('Sending callback to Spotify…');
  try {
    const data = await requestJson('/api/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: value }) }, 15000);
    callback.value = '';
    authSection.hidden = true;
    openAuth.removeAttribute('href');
    showMessage(data.message);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    sendCallback.disabled = false;
    login.disabled = false;
  }
});
(async () => {
  // A previous attempt (e.g. the boot click) may already have captured a
  // URL. Show it immediately instead of demanding another click.
  try {
    const data = await requestJson('/api/url', {}, 10000);
    if (!data.url) return;
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || url.hostname !== 'accounts.spotify.com' || url.port || url.username || url.password) return;
    openAuth.href = url.href;
    authSection.hidden = false;
    callback.form.hidden = false;
    showMessage('A captured login URL is already waiting. Open the link above to finish logging in, then paste the callback URL below.');
  } catch {
    // No URL captured yet; the user starts with Click Log in.
  }
})();
</script></body></html>`;
}

function markerPath(config: Config): string {
  return `${config.runtimeDir}/logged-in`;
}

async function markerExists(config: Config): Promise<boolean> {
  try {
    await readFile(markerPath(config), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function capturedUrl(config: Config): Promise<string | null> {
  let value = "";
  try {
    value = (await readFile(authUrlPath(config), "utf8")).trim();
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    return null;
  }
  if (!value) return null;
  const captured = new URL(value);
  if (
    captured.protocol !== "https:" ||
    captured.hostname !== "accounts.spotify.com" ||
    captured.port ||
    captured.username ||
    captured.password
  )
    throw new Error("Invalid captured URL");
  return captured.href;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16384) throw new Error("Callback request is too large");
    chunks.push(buffer);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new Error("Send the callback URL as a JSON object");
  }
}

function validateCallback(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Paste the complete http://127.0.0.1:4381/login?... URL");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== "4381" ||
    parsed.pathname !== "/login" ||
    !parsed.search ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new Error("Paste the complete http://127.0.0.1:4381/login?... URL");
  return parsed;
}

function deliverCallback(parsed: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    const upstream = httpRequest(
      `http://127.0.0.1:4381/login${parsed.search}`,
      (response) => {
        response.once("error", reject);
        response.resume();
        response.once("end", () => {
          if ((response.statusCode ?? 500) >= 400)
            reject(new Error("Spotify rejected the callback"));
          else resolve();
        });
      },
    );
    const timer = setTimeout(
      () => upstream.destroy(new Error("Spotify callback timed out")),
      10000,
    );
    upstream.once("close", () => clearTimeout(timer));
    upstream.once("error", reject);
    upstream.end();
  });
}

function proxyWebrtc(request: IncomingMessage, response: ServerResponse): void {
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: 8889,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        host: request.headers.host ?? "127.0.0.1:8889",
      },
    },
    (source) => {
      response.writeHead(source.statusCode ?? 502, source.headers);
      source.pipe(response);
    },
  );
  upstream.once("error", (error) => {
    if (!response.headersSent) response.writeHead(502);
    response.end(`WebRTC unavailable: ${error.message}`);
  });
  request.pipe(upstream);
}

function proxyWebrtcUpgrade(
  request: IncomingMessage,
  socket: import("node:net").Socket,
  head: Buffer,
): void {
  const upstream = connectSocket(8889, "127.0.0.1", () => {
    const headers = Object.entries(request.headers)
      .map(
        ([name, value]) =>
          `${name}: ${Array.isArray(value) ? value.join(", ") : value}`,
      )
      .join("\r\n");
    upstream.write(`GET ${request.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once("error", () => socket.destroy());
  socket.once("error", () => upstream.destroy());
}

export function createWebServer(api: RuntimeApi): Server {
  let loginId = 0;
  let clicking = false;
  let captureExpires = 0;
  // Set when an attempt finishes without a URL on disk: the client is
  // probably parked on the post-click waiting screen, so the next attempt
  // resets it to a pristine first-run screen before clicking.
  let needsReset = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/" && request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      response.end(rootPage());
      return;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, api.ready() ? 200 : 503, { ready: api.ready() });
      return;
    }
    if (url.pathname === "/api/login" && request.method === "POST") {
      if (clicking) {
        sendJson(response, 409, {
          error: "A login click is already in progress. Wait, then try again.",
        });
        return;
      }
      if (await markerExists(api.config)) {
        sendJson(response, 409, {
          error:
            "Spotify already logged in here. If it really is not, delete the logged-in marker from the data volume and try again.",
        });
        return;
      }
      clicking = true;
      captureExpires = 0;
      loginId += 1;
      try {
        // No rm: a previously captured (unused) URL stays valid and usable.
        const fired = await clickLogin({
          environment: api.environment,
          capturePath: authUrlPath(api.config),
          cacheDir: api.config.cacheDir,
          reset: needsReset,
        });
        needsReset = !fired && (await capturedUrl(api.config)) === null;
        captureExpires = Date.now() + 70000;
        sendJson(response, 200, { id: loginId });
      } catch (error) {
        needsReset = true;
        sendJson(response, 503, {
          error:
            error instanceof Error && /login screen/.test(error.message)
              ? error.message
              : "Could not click Spotify Log in. Check that the Spotify window is available, then try again.",
        });
      } finally {
        clicking = false;
      }
      return;
    }
    if (url.pathname === "/api/login" && request.method === "GET") {
      if (
        url.searchParams.get("attempt") !== String(loginId) ||
        clicking ||
        Date.now() >= captureExpires
      ) {
        sendJson(response, 409, {
          error:
            "This login attempt expired or was replaced. Click Log in again.",
        });
        return;
      }
      try {
        const href = await capturedUrl(api.config);
        if (!href) {
          sendJson(response, 202, { pending: true });
          return;
        }
        sendJson(response, 200, { url: href });
      } catch {
        sendJson(response, 503, {
          error:
            "Could not read a valid Spotify authorization URL. Click Log in again.",
        });
      }
      return;
    }
    if (url.pathname === "/api/url" && request.method === "GET") {
      try {
        const href = await capturedUrl(api.config);
        if (!href) {
          sendJson(response, 404, { pending: true });
          return;
        }
        sendJson(response, 200, { url: href });
      } catch {
        sendJson(response, 503, {
          error: "Could not read a valid Spotify authorization URL.",
        });
      }
      return;
    }
    if (url.pathname === "/api/callback" && request.method === "POST") {
      let callback: URL;
      try {
        const body = await readJson(request);
        callback = validateCallback(
          typeof body.url === "string" ? body.url : "",
        );
      } catch (error) {
        sendJson(response, 400, {
          error:
            error instanceof Error ? error.message : "Invalid callback URL",
        });
        return;
      }
      try {
        await deliverCallback(callback);
        captureExpires = 0;
        needsReset = false;
        await rm(authUrlPath(api.config), { force: true }).catch(
          () => undefined,
        );
        await writeFile(markerPath(api.config), `${new Date().toISOString()}\n`).catch(
          () => undefined,
        );
        sendJson(response, 200, {
          message: "Callback delivered. Spotify should now be logged in.",
        });
      } catch {
        sendJson(response, 502, {
          error:
            "Spotify did not accept the callback. Click Log in again and repeat the flow with the new URLs.",
        });
      }
      return;
    }
    if (url.pathname === "/spotify" || url.pathname.startsWith("/spotify/")) {
      proxyWebrtc(request, response);
      return;
    }
    if (
      url.pathname.startsWith("/spotify-") &&
      url.pathname.endsWith(".opus") &&
      request.method === "GET"
    ) {
      await api.icecast.proxy(url.pathname, response);
      return;
    }
    response
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Not found");
  });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/spotify" || pathname.startsWith("/spotify/"))
      proxyWebrtcUpgrade(request, socket, head);
    else socket.destroy();
  });
  return server;
}
