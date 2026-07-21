#!/usr/bin/env python3
"""
Long-running media fetch worker.
Keeps a curl_cffi session warm so HLS segments don't pay process-spawn cost.

GET /health
GET /fetch?url=<encoded>
"""
from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    from curl_cffi import requests
except ImportError:
    print("curl_cffi required", file=sys.stderr)
    sys.exit(2)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
SESSION = requests.Session()
IMPERSONATE = "chrome131"
HEADERS = {
    "Referer": "https://missav.ws/",
    "Origin": "https://missav.ws",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}

ALLOW_SUFFIXES = (
    "surrit.com",
    "fourhoi.com",
    "missav.ws",
    "missav.ai",
)


def allowed(url: str) -> bool:
    try:
        host = urlparse(url).hostname or ""
        host = host.lower()
        return any(host == s or host.endswith("." + s) for s in ALLOW_SUFFIXES)
    except Exception:
        return False


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # quieter
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str = "application/octet-stream"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=30")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            body = json.dumps({"ok": True, "service": "aether-media"}).encode()
            self._send(200, body, "application/json")
            return

        if parsed.path != "/fetch":
            self._send(404, b"not found", "text/plain")
            return

        qs = parse_qs(parsed.query)
        url = (qs.get("url") or [""])[0]
        if not url or not allowed(url):
            self._send(400, b"bad url", "text/plain")
            return

        try:
            r = SESSION.get(
                url,
                impersonate=IMPERSONATE,
                headers=HEADERS,
                timeout=40,
                allow_redirects=True,
            )
            ctype = r.headers.get("content-type") or "application/octet-stream"
            if r.status_code != 200:
                self._send(r.status_code, r.content[:500] or b"error", "text/plain")
                return
            self._send(200, r.content, ctype)
        except Exception as e:
            self._send(502, str(e).encode("utf-8", "replace"), "text/plain")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[aether-media] listening on 127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
