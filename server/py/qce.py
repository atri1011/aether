#!/usr/bin/env python3
"""av.qce.me public short-drama site: catalog JSON + signed HLS playlists.

The site exposes a small read-only JSON API (no accounts, no cookies):

  GET /api/catalog?page=&size=&category=&q=   catalog page + category counts
  GET /api/drama/<id>                         detail with per-episode signed m3u8
  GET /cover/<id>                             plain JPEG poster
  GET /hls/<n>/index.m3u8?s=..&e=..           AES-128 playlist (key + segments)
"""
from __future__ import annotations

import base64
import json
import re
import sys
from urllib.parse import urljoin, urlparse

from curl_cffi import requests
from curl_opts import CURL_OPTS

ORIGIN = "https://av.qce.me"
HOST = "av.qce.me"
PAGE_SIZE = 24
MAX_PAGE = 10000
MAX_ID = 999999999999
MAX_EPISODE = 10000
LIMITS = {"page": 2 * 1024 * 1024, "cover": 8 * 1024 * 1024, "media": 64 * 1024 * 1024}
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": ORIGIN + "/",
    "Origin": ORIGIN,
}


class ProviderError(Exception):
    def __init__(self, message, code="UPSTREAM"):
        super().__init__(message)
        self.code = code


def valid_url(url, kind="media"):
    try:
        p = urlparse(url)
        if not (len(url) <= 8192 and p.scheme == "https" and p.hostname == HOST):
            return False
        if p.port not in (None, 443) or p.username or p.password or p.fragment:
            return False
        if any(ord(c) < 33 for c in url):
            return False
        if kind == "cover":
            return p.path.startswith("/cover/")
        if kind == "media":
            return p.path.startswith("/hls/")
        return p.path.startswith("/api/")
    except (ValueError, TypeError):
        return False


def positive(value, maximum):
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]*", str(value)) or int(value) > maximum:
        raise ProviderError("Invalid drama identifier or page", "CONFIG")
    return int(value)


def fetch(path, kind="page", *, stream=False):
    """Fetch one source URL. With stream=True the caller owns the response body."""
    url = path if path.startswith("https://") else ORIGIN + path
    if not valid_url(url, kind):
        raise ProviderError("Unsupported Qce source URL")
    r = requests.get(url, headers=dict(HEADERS), impersonate="chrome124",
                     timeout=35, allow_redirects=False, stream=stream,
                     curl_options=CURL_OPTS or None)
    try:
        if r.status_code == 404:
            raise ProviderError("Source item not found", "NOT_FOUND")
        if r.status_code != 200:
            raise ProviderError("Qce source unavailable")
        length = int(r.headers.get("content-length") or 0)
        if length and length > LIMITS[kind]:
            raise ProviderError("Source response too large")
        return r
    except Exception:
        r.close()
        raise


def load_json(path):
    r = fetch(path)
    try:
        raw = r.content
        if len(raw) > LIMITS["page"]:
            raise ProviderError("Source response too large")
        return json.loads(raw)
    except ValueError:
        raise ProviderError("Invalid Qce JSON response")
    finally:
        r.close()


def summary(item):
    if not isinstance(item, dict):
        raise ProviderError("Invalid source drama")
    drama_id = str(positive(item.get("id"), MAX_ID))
    title = item.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ProviderError("Incomplete source drama")
    cover = item.get("cover") if isinstance(item.get("cover"), str) else ""
    cover = urljoin(ORIGIN, cover) if cover else ""
    if cover and not valid_url(cover, "cover"):
        cover = ""
    out = {
        "id": drama_id,
        "title": title.strip()[:500],
        "coverUrl": cover,
        "description": str(item.get("description") or "")[:10000],
    }
    category = item.get("category")
    if isinstance(category, str) and category.strip():
        out["category"] = category.strip()[:80]
    badge = item.get("badge")
    if isinstance(badge, str) and badge.strip():
        out["badge"] = badge.strip()[:40]
    count = item.get("episodes") or item.get("episode_count")
    if count is not None:
        try:
            out["episodeCount"] = positive(count, MAX_EPISODE)
        except ProviderError:
            pass
    if "is_finished" in item:
        out["status"] = "completed" if item["is_finished"] in (True, 1, "1", "true") else "ongoing"
    return out


def parse_list(payload, page, category):
    if not isinstance(payload, dict) or not isinstance(payload.get("list"), list):
        raise ProviderError("Invalid Qce catalog response")
    items = [summary(item) for item in payload["list"]]
    if len(items) > PAGE_SIZE:
        raise ProviderError("Invalid Qce page size")
    total = payload.get("total")
    if not isinstance(total, int) or total < 0:
        raise ProviderError("Invalid Qce catalog total")
    categories = []
    for entry in payload.get("categories") or []:
        if isinstance(entry, dict) and isinstance(entry.get("name"), str) and isinstance(entry.get("count"), int):
            categories.append({"name": entry["name"][:80], "count": entry["count"]})
    has_more = payload.get("has_more")
    if not isinstance(has_more, bool):
        has_more = bool(items) and page * PAGE_SIZE < total
    return {
        "items": items,
        "page": page,
        "pageSize": PAGE_SIZE,
        "hasMore": has_more,
        "total": total,
        "categories": categories,
        "category": category,
    }


def parse_detail(payload, drama_id):
    if not isinstance(payload, dict) or str(payload.get("id")) != drama_id:
        raise ProviderError("Qce returned a different drama")
    drama = summary(payload)
    rank = {}
    for entry in payload.get("eps") or []:
        if not isinstance(entry, dict):
            continue
        try:
            number = positive(entry.get("ep"), MAX_EPISODE)
        except ProviderError:
            continue
        url = entry.get("url")
        if not isinstance(url, str) or not url:
            continue
        url = urljoin(ORIGIN, url)
        if not valid_url(url, "media"):
            continue
        rank[number] = url
    drama["episodeCount"] = len(rank) or drama.get("episodeCount")
    if not drama.get("description"):
        drama.pop("description", None)
    return {
        "drama": drama,
        "episodes": [
            {"id": f"ep-{n}", "number": n, "title": f"第 {n} 集", "url": rank[n]}
            for n in sorted(rank)
        ],
    }


def require_category(raw):
    if not isinstance(raw, str):
        return ""
    value = raw.strip()
    if not value:
        return ""
    if len(value) > 40 or any(ord(c) < 32 for c in value):
        raise ProviderError("Invalid category", "CONFIG")
    return value


def scrape(body):
    try:
        mode = body.get("mode", "list")
        if mode == "list":
            page = positive(body.get("page", 1), MAX_PAGE)
            category = require_category(body.get("category", ""))
            path = f"/api/catalog?page={page}&size={PAGE_SIZE}"
            if category:
                from urllib.parse import quote

                path += "&category=" + quote(category, safe="")
            result = parse_list(load_json(path), page, category)
        elif mode == "detail":
            drama_id = str(positive(body.get("id"), MAX_ID))
            result = parse_detail(load_json(f"/api/drama/{drama_id}"), drama_id)
        elif mode == "resolve":
            drama_id = str(positive(body.get("id"), MAX_ID))
            episode = positive(body.get("episode", 1), MAX_EPISODE)
            detail = parse_detail(load_json(f"/api/drama/{drama_id}"), drama_id)
            match = next((ep for ep in detail["episodes"] if ep["number"] == episode), None)
            if not match:
                raise ProviderError("Episode not found", "NOT_FOUND")
            url = match["url"]
            media_type = "hls" if urlparse(url).path.lower().endswith(".m3u8") else None
            if not media_type:
                raise ProviderError("Unsupported Qce playback format")
            result = {"url": url, "type": media_type}
        elif mode == "cover":
            drama_id = str(positive(body.get("id"), MAX_ID))
            r = fetch(f"/cover/{drama_id}", "cover")
            try:
                content = r.content
                if len(content) > LIMITS["cover"]:
                    raise ProviderError("Source response too large")
                if not content[:3] == b"\xff\xd8\xff" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ProviderError("Unsupported cover format")
                result = {"base64": base64.b64encode(content).decode("ascii")}
            finally:
                r.close()
        else:
            raise ProviderError("Unknown drama operation", "CONFIG")
        return {"ok": True, **result}
    except ProviderError as e:
        return {"ok": False, "error": str(e), "code": e.code}
    except Exception:
        return {"ok": False, "error": "Qce source could not be read", "code": "UPSTREAM"}


if __name__ == "__main__":
    print(json.dumps(scrape(json.loads(sys.argv[1])), ensure_ascii=False))
