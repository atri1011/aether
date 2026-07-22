#!/usr/bin/env python3
"""Scrape MissAV genres / makers index pages into JSON.

MissAV catalog pages (e.g. /cn/genres?page=2) list ~36 cards per page.
Each card has a title link (class text-nord13) and a count link ("N 条影片").
"""
from __future__ import annotations

import html as html_lib
import json
import re
import sys
from urllib.parse import quote, unquote, urlencode

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

KINDS = {"genres", "makers"}

DEFAULT_HEADERS = {
    "Referer": "https://missav.ai/",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

LOCALE_MAP = {
    "zh": "cn",
    "cn": "cn",
    "en": "en",
    "ja": "ja",
}


def normalize_locale(locale: str) -> str:
    loc = (locale or "zh").lower()
    if loc.startswith("en"):
        return "en"
    if loc.startswith("ja"):
        return "ja"
    return "zh"


def site_locale(locale: str) -> str:
    return LOCALE_MAP.get(normalize_locale(locale), "cn")


def bases() -> list[str]:
    return ["https://missav.ai", "https://missav.ws"]


def candidate_urls(kind: str, page: int, locale: str) -> list[str]:
    kind = kind.strip("/")
    loc = site_locale(locale)
    qs = urlencode({"page": str(page)}) if page > 1 else ""
    qstr = f"?{qs}" if qs else ""
    urls: list[str] = []
    for host in bases():
        if loc == "cn":
            urls += [
                f"{host}/dm22/cn/{kind}{qstr}",
                f"{host}/dm539/cn/{kind}{qstr}",
                f"{host}/dm14/cn/{kind}{qstr}",
                f"{host}/cn/{kind}{qstr}",
                f"{host}/zh/{kind}{qstr}",
            ]
        else:
            urls += [
                f"{host}/dm22/{loc}/{kind}{qstr}",
                f"{host}/dm14/{loc}/{kind}{qstr}",
                f"{host}/{loc}/{kind}{qstr}",
            ]
    return urls


_LINK_RE = re.compile(
    r'href="[^"]*/(?:genres|makers)/([^"#?]+)"\s*(?:class="([^"]*)")?\s*>\s*([^<]*?)\s*</a>',
    re.I | re.S,
)

_COUNT_RE = re.compile(
    r"([\d,]+)\s*(?:条影片|條影片|videos?)",
    re.I,
)


def _clean_text(s: str) -> str:
    t = html_lib.unescape(re.sub(r"\s+", " ", (s or "")).strip())
    return t


def parse_catalog(html: str, kind: str) -> list[dict]:
    """Parse genre/maker cards from an index page.

    Prefer the title anchor (class contains text-nord13). Fall back to the
    path segment itself when only a count link is present.
    """
    # name -> {title, count}
    bag: dict[str, dict] = {}
    order: list[str] = []

    for enc, cls, raw_title in _LINK_RE.findall(html or ""):
        name = unquote(enc or "").strip()
        if not name:
            continue
        # skip bare index links
        if name.lower() in KINDS:
            continue
        title = _clean_text(raw_title)
        cls = cls or ""
        count = None
        m = _COUNT_RE.search(title)
        if m:
            try:
                count = int(m.group(1).replace(",", ""))
            except ValueError:
                count = None
            # count-only link — keep count, don't overwrite a real title
            if name not in bag:
                bag[name] = {"name": name, "title": name, "count": count}
                order.append(name)
            else:
                if count is not None and bag[name].get("count") is None:
                    bag[name]["count"] = count
            continue

        if not title:
            continue

        is_title = "text-nord13" in cls or not _COUNT_RE.search(title)
        if name not in bag:
            bag[name] = {
                "name": name,
                "title": title if is_title else name,
                "count": None,
            }
            order.append(name)
        else:
            if is_title and title:
                bag[name]["title"] = title

    # Drop pure nav noise: sidebar also links genres/VR etc. with menu classes.
    # On catalog pages real cards always come with a count sibling → keep those
    # first; if a page has counts, drop items without count that look like nav.
    has_any_count = any(v.get("count") is not None for v in bag.values())
    items: list[dict] = []
    for name in order:
        it = bag[name]
        if has_any_count and it.get("count") is None:
            # keep VR etc. only if title looks like a real catalog row —
            # nav entries often repeat early; skip uncounted when counts exist
            continue
        items.append(
            {
                "name": it["name"],
                "title": it["title"] or it["name"],
                "count": it.get("count"),
                "listPath": f"{kind}/{it['name']}",
            }
        )
    return items


def parse_max_page(html: str) -> int:
    pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", html or "")]
    return max(pages) if pages else 1


def scrape(kind: str, page: int = 1, locale: str = "zh") -> dict:
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        return {"ok": False, "error": f"unknown kind: {kind}"}
    page = max(1, int(page or 1))
    locale = normalize_locale(locale)
    last = {
        "ok": False,
        "error": "no candidate succeeded",
        "kind": kind,
        "page": page,
        "locale": locale,
    }

    for url in candidate_urls(kind, page, locale):
        try:
            r = requests.get(
                url,
                impersonate="chrome131",
                timeout=30,
                allow_redirects=True,
                headers={
                    **DEFAULT_HEADERS,
                    "Referer": f"https://missav.ai/{site_locale(locale)}/{kind}",
                },
            )
        except Exception as e:
            last = {
                "ok": False,
                "error": str(e),
                "url": url,
                "kind": kind,
                "page": page,
                "locale": locale,
            }
            continue

        if r.status_code != 200:
            last = {
                "ok": False,
                "error": f"status {r.status_code}",
                "url": str(r.url),
                "kind": kind,
                "page": page,
                "locale": locale,
            }
            continue

        # Cloudflare challenge HTML is short / has no catalog cards
        if "Just a moment" in r.text or "cf-browser-verification" in r.text:
            last = {
                "ok": False,
                "error": "cloudflare challenge",
                "url": str(r.url),
                "kind": kind,
                "page": page,
                "locale": locale,
            }
            continue

        items = parse_catalog(r.text, kind)
        if not items:
            last = {
                "ok": False,
                "error": "no items parsed",
                "url": str(r.url),
                "kind": kind,
                "page": page,
                "locale": locale,
            }
            continue

        max_page = parse_max_page(r.text)
        return {
            "ok": True,
            "url": str(r.url),
            "kind": kind,
            "page": page,
            "locale": locale,
            "items": items,
            "count": len(items),
            "maxPage": max_page,
            "hasMore": page < max_page and len(items) >= 8,
        }

    return last


def main():
    # argv: kind page locale
    kind = sys.argv[1] if len(sys.argv) > 1 else "genres"
    page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    locale = sys.argv[3] if len(sys.argv) > 3 else "zh"
    # Always emit UTF-8 JSON (Windows console may default to GBK)
    payload = json.dumps(scrape(kind, page, locale), ensure_ascii=False)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.stdout.buffer.write(payload.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")


if __name__ == "__main__":
    main()
