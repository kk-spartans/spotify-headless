#!/usr/bin/env python3
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen


AUTH_URL_FILE = Path("/data/run/auth-url.txt")


def read_auth_url() -> str | None:
    try:
        value = AUTH_URL_FILE.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    return value or None


class Handler(BaseHTTPRequestHandler):
    def send_page(self, content: str, status: int = 200) -> None:
        body = (
            "<!doctype html><meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>Spotify authorization URL</title>"
            "<style>body{font:16px system-ui;max-width:760px;margin:4rem auto;"
            "padding:0 1rem}pre,textarea{box-sizing:border-box;width:100%;"
            "overflow-wrap:anywhere;background:#eee;padding:1rem}"
            "textarea{min-height:9rem}a{font-size:1.2rem}"
            "button{font:inherit;padding:.7rem 1rem}</style>"
            "<h1>Spotify authorization</h1>"
            + content
        ).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        auth_url = read_auth_url()

        if self.path == "/url":
            body = ((auth_url or "") + "\n").encode()
            self.send_response(200 if auth_url else 404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
        elif self.path == "/open":
            if not auth_url:
                self.send_error(404, "Click Log in inside Spotify first")
                return
            self.send_response(302)
            self.send_header("Location", auth_url)
            body = b""
        else:
            if auth_url:
                content = (
                    "<p>Spotify requested this authorization URL:</p>"
                    f'<p><a href="{escape(auth_url, quote=True)}">Continue to Spotify login</a></p>'
                    f"<pre>{escape(auth_url)}</pre>"
                    "<hr><h2>Finish the login</h2>"
                    "<p>After Spotify redirects your laptop to "
                    "<code>http://127.0.0.1:4381/login?...</code>, copy the "
                    "complete URL from the browser address bar and paste it here.</p>"
                    '<form method="post" action="callback">'
                    '<textarea name="url" required '
                    'placeholder="http://127.0.0.1:4381/login?code=..."></textarea>'
                    '<p><button type="submit">Send callback to Spotify</button></p>'
                    "</form>"
                )
            else:
                content = (
                    "<p>No authorization URL has been captured yet.</p>"
                    "<p>The first-run helper will click <strong>Log in</strong> "
                    "automatically. Open noVNC and click it manually if needed, "
                    "then refresh this page.</p>"
                )
            self.send_page(content)
            return

        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/callback":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            fields = parse_qs(self.rfile.read(length).decode("utf-8"))
            callback = fields["url"][0].strip()
            parsed = urlsplit(callback)
            if (
                parsed.scheme != "http"
                or parsed.hostname not in {"127.0.0.1", "localhost"}
                or parsed.port != 4381
                or parsed.path != "/login"
                or not parsed.query
            ):
                raise ValueError
        except (KeyError, ValueError):
            self.send_page(
                "<p>That is not a Spotify callback URL. Paste the complete "
                "<code>http://127.0.0.1:4381/login?...</code> URL.</p>",
                400,
            )
            return

        internal_url = f"http://127.0.0.1:4381/login?{parsed.query}"
        try:
            with urlopen(internal_url, timeout=10) as response:
                response.read()
        except URLError as error:
            self.send_page(
                "<p>Spotify did not accept the callback. Click <strong>Log in</strong> "
                "again and repeat the flow with the newly generated URLs.</p>"
                f"<pre>{escape(str(error))}</pre>",
                502,
            )
            return

        self.send_page(
            "<p><strong>Callback delivered.</strong> Spotify should now be "
            "logged in. Return to noVNC to confirm.</p>"
        )

    def log_message(self, format: str, *args: object) -> None:
        return


ThreadingHTTPServer(("0.0.0.0", 6090), Handler).serve_forever()
