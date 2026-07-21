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


def scrape(path: str, page: int = 1):
    path = path.strip("/")
    if page > 1:
        url = f"https://missav.ws/en/{path}?page={page}"
    else:
        url = f"https://missav.ws/en/{path}"
    r = requests.get(url, impersonate="chrome131", timeout=25, allow_redirects=True)
    if r.status_code != 200:
        return {"ok": False, "error": f"status {r.status_code}", "url": url}

    html = r.text
    # fourhoi covers imply video codes on listing
    covers = re.findall(r"https://fourhoi\.com/([a-z0-9\-]+)/cover-[nt]\.jpg", html, re.I)
    # href ids
    href_ids = re.findall(
        r'href="(?:https://missav\.ws)?/(?:dm\d+/)?(?:en|zh)/([a-z0-9\-]+)"',
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
        r'text-secondary[^>]*>\s*([A-Z0-9][A-Z0-9\-]+)\s+([^<\n]{3,120})',
        html,
    )
    title_map = {}
    for code, title in titles:
        title_map[code.lower()] = title.strip()

    items = []
    for i in ids:
        items.append(
            {
                "id": i,
                "title": title_map.get(i) or title_map.get(i.split("-uncensored")[0]) or "",
                "coverUrl": f"https://fourhoi.com/{i}/cover-t.jpg",
            }
        )

    return {
        "ok": True,
        "url": str(r.url),
        "path": path,
        "page": page,
        "items": items,
        "count": len(items),
    }


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "new"
    page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    # genres/Creampie style
    if path.startswith("genres/"):
        path = "genres/" + unquote(path.split("/", 1)[1])
    result = scrape(path, page)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
