#!/usr/bin/env python3
"""Scrape MissAV listing pages (new/release/hot/genres) into JSON ids."""
from __future__ import annotations

import json
import re
import sys
from urllib.parse import unquote

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

SKIP = {
    "new",
    "release",
    "uncensored-leak",
    "actresses",
    "genres",
    "makers",
    "vip",
    "english-subtitle",
    "chinese-subtitle",
    "today-hot",
    "weekly-hot",
    "monthly-hot",
    "siro",
    "luxu",
    "gana",
    "maan",
    "scute",
    "ara",
    "fc2",
    "heyzo",
    "tokyohot",
    "1pondo",
    "caribbeancom",
    "caribbeancompr",
    "10musume",
    "pacopacomama",
    "gachinco",
    "saved",
    "login",
    "dm1",
}


def normalize_locale(locale: str) -> str:
    loc = (locale or "zh").lower()
    return "en" if loc.startswith("en") else "zh"


def base_id(raw: str) -> str:
    s = str(raw or "").lower()
    s = re.sub(r"-uncensored-leak$", "", s)
    s = re.sub(r"-chinese-subtitle$", "", s)
    s = re.sub(r"-english-subtitle$", "", s)
    return s


def candidate_urls(path: str, page: int, locale: str) -> list[str]:
    """MissAV zh listings omit the locale segment; en uses /en/."""
    path = path.strip("/")
    if locale == "en":
        bases = [
            f"https://missav.ws/en/{path}",
            f"https://missav.ws/dm539/en/{path}",
            f"https://missav.ws/dm278/en/{path}",
        ]
    else:
        # zh: no locale segment is the site default; keep a few mirrors
        bases = [
            f"https://missav.ws/{path}",
            f"https://missav.ws/dm539/zh/{path}",
            f"https://missav.ws/dm278/{path}",
            f"https://missav.ws/dm539/{path}",
            f"https://missav.ws/zh/{path}",
        ]
    if page > 1:
        return [f"{u}?page={page}" for u in bases]
    return bases


def parse_items(html: str) -> list[dict]:
    covers = re.findall(r"https://fourhoi\.com/([a-z0-9\-]+)/cover-[nt]\.jpg", html, re.I)
    href_ids = re.findall(
        r'href="(?:https://missav\.ws)?/(?:dm\d+/)?(?:en|zh|cn)/?([a-z0-9\-]+)"',
        html,
        re.I,
    )
    ids = []
    seen = set()
    for i in covers + href_ids:
        i = i.lower()
        if i in SKIP or i in seen:
            continue
        if len(i) < 3:
            continue
        seen.add(i)
        ids.append(i)

    titles = re.findall(
        r"text-secondary[^>]*>\s*([A-Z0-9][A-Z0-9\-]+)\s+([^<\n]{3,160})",
        html,
    )
    title_map = {}
    for code, title in titles:
        key = code.lower()
        cleaned = (
            title.replace("&#039;", "'")
            .replace("&amp;", "&")
            .replace("&quot;", '"')
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .strip()
        )
        title_map[key] = cleaned

    items = []
    for i in ids:
        bid = base_id(i)
        title = title_map.get(i) or title_map.get(bid) or ""
        items.append(
            {
                "id": i,
                "title": title,
                "coverUrl": f"https://fourhoi.com/{bid}/cover-t.jpg",
            }
        )
    return items


def scrape(path: str, page: int = 1, locale: str = "zh"):
    path = path.strip("/")
    locale = normalize_locale(locale)
    last = {"ok": False, "error": "no candidate succeeded", "path": path, "page": page, "locale": locale}

    for url in candidate_urls(path, page, locale):
        try:
            r = requests.get(url, impersonate="chrome131", timeout=25, allow_redirects=True)
        except Exception as e:
            last = {"ok": False, "error": str(e), "url": url, "path": path, "page": page, "locale": locale}
            continue

        if r.status_code != 200:
            last = {
                "ok": False,
                "error": f"status {r.status_code}",
                "url": str(r.url),
                "path": path,
                "page": page,
                "locale": locale,
            }
            continue

        items = parse_items(r.text)
        if not items:
            last = {
                "ok": False,
                "error": "no items parsed",
                "url": str(r.url),
                "path": path,
                "page": page,
                "locale": locale,
            }
            continue

        return {
            "ok": True,
            "url": str(r.url),
            "path": path,
            "page": page,
            "locale": locale,
            "items": items,
            "count": len(items),
        }

    return last


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "new"
    page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    locale = sys.argv[3] if len(sys.argv) > 3 else "zh"
    # genres/Creampie style
    if path.startswith("genres/"):
        path = "genres/" + unquote(path.split("/", 1)[1])
    result = scrape(path, page, locale)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
