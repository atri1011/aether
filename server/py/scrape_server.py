#!/usr/bin/env python3
"""
Long-running scrape worker (OPT-01).
Reuses process + curl_cffi sessions; Node talks HTTP JSON.

POST /scrape/list
POST /scrape/actresses
POST /scrape/catalog
POST /resolve
GET  /health
"""
from __future__ import annotations

import json
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18791
CONCURRENCY = int(sys.argv[2]) if len(sys.argv) > 2 else 2
try:
    import os

    CONCURRENCY = max(1, int(os.environ.get("SCRAPE_CONCURRENCY", CONCURRENCY)))
except Exception:
    CONCURRENCY = max(1, CONCURRENCY)

_sem = threading.Semaphore(CONCURRENCY)


def _import_scrapers():
    # Ensure this directory is on sys.path when spawned as absolute script path
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import scrape_list
    import scrape_actresses
    import scrape_catalog
    import resolve_stream

    return scrape_list, scrape_actresses, scrape_catalog, resolve_stream


scrape_list, scrape_actresses, scrape_catalog, resolve_stream = _import_scrapers()


def handle_list(body: dict) -> dict:
    path = body.get("listPath") or body.get("path") or "new"
    page = int(body.get("page") or 1)
    locale = body.get("locale") or "zh"
    filters = body.get("filters") or None
    sort = body.get("sort") or None
    if filters in {"-", ""}:
        filters = None
    if sort in {"-", ""}:
        sort = None
    path = str(path)
    if path.startswith("genres/"):
        rest = path.split("/", 1)[1]
        path = "genres/" + unquote(rest)
    elif path.startswith("makers/"):
        rest = path.split("/", 1)[1]
        path = "makers/" + unquote(rest)
    elif path.startswith("search/"):
        rest = path.split("/", 1)[1]
        path = "search/" + unquote(rest)
    elif path.startswith("actresses/"):
        rest = path.split("/", 1)[1]
        path = "actresses/" + unquote(rest)
    return scrape_list.scrape(path, page, locale, filters=filters, sort=sort)


def handle_actresses(body: dict) -> dict:
    mode = (body.get("mode") or "list").lower()
    locale = body.get("locale") or "zh"
    if mode == "ranking":
        return scrape_actresses.scrape_ranking(locale)
    if mode == "detail":
        slug = body.get("slug") or ""
        page = int(body.get("page") or 1)
        sort = body.get("sort") or None
        filt = body.get("filter") or body.get("filters") or None
        if sort in {"-", ""}:
            sort = None
        if filt in {"-", ""}:
            filt = None
        return scrape_actresses.scrape_detail(slug, page, locale, sort=sort, filt=filt)
    if mode == "search":
        q = body.get("q") or ""
        limit = int(body.get("limit") or 12)
        return scrape_actresses.scrape_search(q, locale, limit)
    # list
    page = int(body.get("page") or 1)
    sort = body.get("sort") or None
    height = body.get("height") or None
    cup = body.get("cup") or None
    age = body.get("age") or None
    debut = body.get("debut") or None
    for name in ("sort", "height", "cup", "age", "debut"):
        val = locals()[name]
        if val in {"-", ""}:
            if name == "sort":
                sort = None
            elif name == "height":
                height = None
            elif name == "cup":
                cup = None
            elif name == "age":
                age = None
            elif name == "debut":
                debut = None
    return scrape_actresses.scrape_list(
        page, locale, sort=sort, height=height, cup=cup, age=age, debut=debut
    )


def handle_catalog(body: dict) -> dict:
    kind = body.get("kind") or "genres"
    page = int(body.get("page") or 1)
    locale = body.get("locale") or "zh"
    return scrape_catalog.scrape(kind, page, locale)


def handle_resolve(body: dict) -> dict:
    video_id = str(body.get("id") or body.get("videoId") or "").strip()
    if not video_id:
        return {"ok": False, "error": "id required"}
    return resolve_stream.resolve(video_id)


ROUTES = {
    "/scrape/list": handle_list,
    "/scrape/actresses": handle_actresses,
    "/scrape/catalog": handle_catalog,
    "/resolve": handle_resolve,
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/health":
            self._send_json(
                200,
                {
                    "ok": True,
                    "service": "aether-scrape",
                    "concurrency": CONCURRENCY,
                },
            )
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        handler = ROUTES.get(path)
        if not handler:
            self._send_json(404, {"ok": False, "error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._send_json(400, {"ok": False, "error": "invalid json"})
            return

        acquired = _sem.acquire(blocking=False)
        if not acquired:
            self.send_response(503)
            retry = b'{"ok":false,"error":"scrape busy","code":"SCRAPE_BUSY"}'
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(retry)))
            self.send_header("Retry-After", "2")
            self.end_headers()
            self.wfile.write(retry)
            return

        try:
            result = handler(body if isinstance(body, dict) else {})
            if not isinstance(result, dict):
                result = {"ok": False, "error": "bad result type"}
            self._send_json(200, result)
        except Exception as e:
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": str(e),
                    "details": traceback.format_exc()[-500:],
                },
            )
        finally:
            _sem.release()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(
        f"[aether-scrape] listening on 127.0.0.1:{PORT} concurrency={CONCURRENCY}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
