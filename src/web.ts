import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as connectSocket } from "node:net";
import { readFile } from "node:fs/promises";
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function rootPage(authUrl: string | undefined, message = ""): string {
  const authSection = authUrl
    ? `<section class="auth-flow" aria-live="polite">
        <p class="eyebrow">One last step</p>
        <h2>Finish the Spotify handoff</h2>
        <p>Open the captured authorization URL, finish Spotify login, then paste the redirect URL below.</p>
        <button class="secondary" type="button" id="open-auth">Open authorization</button>
        <textarea id="auth-url" readonly aria-label="Captured authorization URL">${escapeHtml(authUrl)}</textarea>
        <form id="callback-form">
          <label for="callback">Spotify callback URL</label>
          <textarea id="callback" name="callback" required placeholder="http://127.0.0.1:4381/login?..." spellcheck="false"></textarea>
          <button class="secondary" type="submit">Send callback</button>
        </form>
      </section>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spotify Headless</title><style>
:root{color-scheme:dark;--ink:#f4f7f5;--muted:#a6b4ae;--surface:#13211c;--surface-2:#1b2d26;--line:#2c463a;--accent:#b7f36b;--accent-ink:#10200f;--danger:#ff8e8e}
*{box-sizing:border-box}body{margin:0;background:#0d1512;color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{min-height:100svh;display:grid;place-items:center;padding:28px 18px;background:radial-gradient(circle at 80% 10%,#234532 0,transparent 35%),#0d1512}.shell{width:min(100%,780px)}.topline{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:76px}.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.02em}.mark{width:12px;height:12px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 6px #b7f36b1c}.status{color:var(--muted);font-size:13px}.hero{max-width:620px}.eyebrow{margin:0 0 14px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.hero h1{margin:0;max-width:11ch;font-size:clamp(42px,8vw,76px);line-height:.98;letter-spacing:-.06em;text-wrap:balance}.lede{max-width:48ch;margin:24px 0 34px;color:var(--muted);font-size:18px}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.primary,.secondary,.link{border:0;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;transition:transform 180ms ease,background 180ms ease,box-shadow 180ms ease}.primary{padding:14px 20px;background:var(--accent);color:var(--accent-ink);box-shadow:0 10px 30px #b7f36b22}.secondary{padding:11px 16px;background:var(--surface-2);color:var(--ink);border:1px solid var(--line)}.link{display:inline-flex;padding:11px 2px;background:transparent;color:var(--accent);text-decoration:none}.primary:hover,.secondary:hover,.link:hover{transform:translateY(-2px)}.primary:focus-visible,.secondary:focus-visible,.link:focus-visible,textarea:focus-visible{outline:3px solid #fff;outline-offset:3px}.primary:disabled{cursor:wait;opacity:.65;transform:none}.message{min-height:25px;margin:20px 0;color:var(--muted)}.auth-flow{margin-top:72px;padding-top:26px;border-top:1px solid var(--line);max-width:620px}.auth-flow h2{margin:0 0 8px;font-size:24px;letter-spacing:-.03em}.auth-flow p:not(.eyebrow){color:var(--muted)}textarea{display:block;width:100%;min-height:78px;margin:12px 0 18px;padding:12px;border:1px solid var(--line);border-radius:12px;background:#0a100e;color:var(--ink);font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}label{display:block;margin-top:22px;color:var(--muted);font-size:13px;font-weight:700}.auth-flow .secondary{margin-bottom:4px}@media(max-width:560px){.topline{margin-bottom:54px}.status{display:none}.hero h1{font-size:54px}.lede{font-size:16px}.actions{align-items:flex-start;flex-direction:column}.primary,.secondary,.link{width:100%;text-align:center;justify-content:center}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important}}
</style></head><body><main><div class="shell"><div class="topline"><div class="brand"><span class="mark" aria-hidden="true"></span>Spotify Headless</div><div class="status">audio relay online</div></div><section class="hero"><p class="eyebrow">Remote control</p><h1>Put the music back in the room.</h1><p class="lede">Trigger Spotify's built-in login flow without a desktop viewer, then listen through the low-latency browser stream.</p><div class="actions"><button class="primary" type="button" id="login">Click Log in</button><a class="link" href="/spotify">Open WebRTC stream <span aria-hidden="true">&nbsp;↗</span></a></div><p class="message" id="message">${escapeHtml(message || "Ready when you are.")}</p></section>${authSection}</div></main><script>
const message=document.querySelector('#message');const login=document.querySelector('#login');
login?.addEventListener('click',async()=>{login.disabled=true;message.textContent='Looking for Spotify and clicking Log in…';try{const response=await fetch('/api/login',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Login click failed');message.textContent='Login clicked. Finish the Spotify handoff below when it appears.';setTimeout(()=>location.reload(),1500)}catch(error){message.textContent=error.message;login.disabled=false}});
document.querySelector('#open-auth')?.addEventListener('click',()=>{const value=document.querySelector('#auth-url').value;window.open(value,'_blank','noopener,noreferrer')});
document.querySelector('#callback-form')?.addEventListener('submit',async(event)=>{event.preventDefault();const value=document.querySelector('#callback').value;message.textContent='Sending callback to Spotify…';const response=await fetch('/api/callback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:value})});const data=await response.json();message.textContent=response.ok?data.message:(data.error||'Callback failed')});
</script></body></html>`;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function validateCallback(value: string): URL {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.port !== "4381" || parsed.pathname !== "/login" || !parsed.search) throw new Error("Paste the complete http://127.0.0.1:4381/login?... URL");
  return parsed;
}

function deliverCallback(parsed: URL): Promise<void> {
  return new Promise((resolve, reject) => {
    const upstream = httpRequest(`http://127.0.0.1:4381/login${parsed.search}`, (response) => {
      response.resume();
      response.once("end", () => {
        if ((response.statusCode ?? 500) >= 400) reject(new Error(`Spotify rejected the callback (${response.statusCode})`));
        else resolve();
      });
    });
    upstream.once("error", reject);
    upstream.end();
  });
}

function proxyWebrtc(request: IncomingMessage, response: ServerResponse): void {
  const upstream = httpRequest({ host: "127.0.0.1", port: 8889, path: request.url, method: request.method, headers: { ...request.headers, host: request.headers.host ?? "127.0.0.1:8889" } }, (source) => {
    response.writeHead(source.statusCode ?? 502, source.headers);
    source.pipe(response);
  });
  upstream.once("error", (error) => { if (!response.headersSent) response.writeHead(502); response.end(`WebRTC unavailable: ${error.message}`); });
  request.pipe(upstream);
}

function proxyWebrtcUpgrade(request: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void {
  const upstream = connectSocket(8889, "127.0.0.1", () => {
    const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`).join("\r\n");
    upstream.write(`GET ${request.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.once("error", () => socket.destroy());
  socket.once("error", () => upstream.destroy());
}

export function createWebServer(api: RuntimeApi): Server {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/" && request.method === "GET") {
      let authUrl: string | undefined;
      try { authUrl = (await readFile(authUrlPath(api.config), "utf8")).trim() || undefined; } catch { /* first login has not happened */ }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(rootPage(authUrl));
      return;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      sendJson(response, api.ready() ? 200 : 503, { ready: api.ready() });
      return;
    }
    if (url.pathname === "/api/login" && request.method === "POST") {
      try { await clickLogin(api.environment); sendJson(response, 200, { ok: true }); } catch (error) { sendJson(response, 503, { error: error instanceof Error ? error.message : "Login click failed" }); }
      return;
    }
    if (url.pathname === "/api/callback" && request.method === "POST") {
      try { const body = await readJson(request); await deliverCallback(validateCallback(String(body.url ?? ""))); sendJson(response, 200, { message: "Callback delivered. Spotify should now be logged in." }); } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : "Callback failed" }); }
      return;
    }
    if (url.pathname === "/spotify" || url.pathname.startsWith("/spotify/")) {
      proxyWebrtc(request, response);
      return;
    }
    if (url.pathname.startsWith("/spotify-") && url.pathname.endsWith(".opus") && request.method === "GET") {
      await api.icecast.proxy(url.pathname, response);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/spotify" || pathname.startsWith("/spotify/")) proxyWebrtcUpgrade(request, socket, head);
    else socket.destroy();
  });
  return server;
}
