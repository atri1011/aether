#!/usr/bin/env python3
"""Scrape MissAV listing pages (new/release/hot/genres/search) into JSON ids.

Supports missav-style query params:
  filters=individual|multiple|chinese-subtitle|...
  sort=released_at|published_at|saved|today_views|weekly_views|monthly_views|views
  page=N
"""
from __future__ import annotations

import json
import re
import sys
from urllib.parse import quote, unquote, urlencode

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

# Nav / footer / sister-site paths that look like slugs but are not DVD ids
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
    "search",
    "ranking",
    "jav",
    "uncensored",
    "asiaav",
    # footer / partner sites / site chrome (were polluting grids)
    "xxxav",
    "marriedslash",
    "naughty4610",
    "naughty0930",
    "madou",
    "twav",
    "furuke",
    "klive",
    "clive",
    "playlists",
    "history",
    "contact",
    "ads",
    "terms",
    "upload",
    "articles",
    "dmca",
    "message",
    "genres",
    "makers",
    "directors",
    "series",
    "labels",
    "tags",
    "legacy",
    "settings",
    "register",
    "logout",
    "password",
    "forgot",
    "user",
    "users",
    "api",
    "cdn",
    "static",
    "assets",
    "images",
    "img",
    "css",
    "js",
    "fonts",
    "favicon",
    "robots",
    "sitemap",
    "feed",
    "rss",
    "about",
    "privacy",
    "help",
    "faq",
    "support",
    "telegram",
    "discord",
    "twitter",
    "facebook",
    "instagram",
}

# Real DVD / product ids look like: ssis-698, faxx-9002b, fc2-ppv-1234567, 1pondo-010121_001
_VIDEO_ID_RE = re.compile(
    r"""^(?:
        [a-z]{1,15}-\d{2,7}[a-z0-9\-]*          # SSIS-698 / FAXX-9002B / XXX-123-chinese-subtitle
      | fc2-ppv-\d{4,10}                          # FC2-PPV-1234567
      | \d+pondo-[a-z0-9_\-]+                     # 1pondo-...
      | (?:heyzo|caribbeancom|10musume|pacopacomama|gachinco|tokyo-hot|tokyohot)-[a-z0-9_\-]+
    )$""",
    re.I | re.X,
)


def is_video_id(raw: str) -> bool:
    """True only for product-like slugs, not nav / partner / bare words."""
    s = (raw or "").lower().strip().strip("/")
    if not s or s in SKIP:
        return False
    if len(s) < 5 or len(s) > 80:
        return False
    if not re.search(r"\d", s):
        return False
    # pure digits or pure letters+digits without hyphen (naughty4610, etc.)
    if re.fullmatch(r"[a-z]+\d+", s) and "-" not in s:
        return False
    if re.fullmatch(r"\d+", s):
        return False
    if re.fullmatch(r"(dm\d+|cn|en|zh|ja|ko|ms|th|de|fr|vi|id|fil|pt)", s):
        return False
    if _VIDEO_ID_RE.match(s):
        return True
    # looser fallback: must have hyphen AND digits on the right side
    if "-" in s:
        left, _, right = s.partition("-")
        if left and re.search(r"\d", right) and re.fullmatch(r"[a-z0-9]+", left):
            # still reject known junk prefixes
            if left in SKIP:
                return False
            return True
    return False


def normalize_locale(locale: str) -> str:
    loc = (locale or "zh").lower()
    return "en" if loc.startswith("en") else "zh"


def site_locale(locale: str) -> str:
    """MissAV uses /cn/ for simplified Chinese UI."""
    return "en" if normalize_locale(locale) == "en" else "cn"


def base_id(raw: str) -> str:
    s = str(raw or "").lower()
    s = re.sub(r"-uncensored-leak$", "", s)
    s = re.sub(r"-chinese-subtitle$", "", s)
    s = re.sub(r"-english-subtitle$", "", s)
    return s


def build_query(page: int, filters: str | None = None, sort: str | None = None) -> dict:
    qs: dict = {}
    if filters:
        qs["filters"] = filters
    if sort:
        qs["sort"] = sort
    if page > 1:
        qs["page"] = str(page)
    return qs


def encode_path(path: str) -> str:
    """Encode each path segment (keeps / separators; encodes CJK etc.)."""
    parts = [p for p in path.strip("/").split("/") if p]
    return "/".join(quote(unquote(p), safe="") for p in parts)


def candidate_urls(
    path: str,
    page: int,
    locale: str,
    *,
    filters: str | None = None,
    sort: str | None = None,
) -> list[str]:
    """Build listing URLs across missav.ai / missav.ws with locale + query."""
    path = encode_path(path)
    loc = site_locale(locale)
    qs = build_query(page, filters, sort)
    qstr = ("?" + urlencode(qs)) if qs else ""

    hosts = ["https://missav.ai", "https://missav.ws"]
    urls: list[str] = []
    for host in hosts:
        if loc == "cn":
            urls += [
                f"{host}/cn/{path}{qstr}",
                f"{host}/dm539/cn/{path}{qstr}",
                f"{host}/dm14/cn/{path}{qstr}",
                f"{host}/{path}{qstr}",
                f"{host}/zh/{path}{qstr}",
                f"{host}/dm539/{path}{qstr}",
            ]
        else:
            urls += [
                f"{host}/en/{path}{qstr}",
                f"{host}/dm539/en/{path}{qstr}",
                f"{host}/dm14/en/{path}{qstr}",
                f"{host}/dm278/en/{path}{qstr}",
            ]
    return urls


def parse_items(html: str) -> list[dict]:
    """Extract video cards only.

    Prefer fourhoi cover URLs (actual thumbnails on listing grids).
    Never trust bare page hrefs alone — footer links (madou, history, upload…)
    look like slugs and used to pollute the grid with blank covers.
    """
    # Cover order ≈ listing order on missav pages
    covers = re.findall(r"https://fourhoi\.com/([a-z0-9\-]+)/cover-[nt]\.jpg", html, re.I)

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
        # also index without suffix
        title_map.setdefault(base_id(key), cleaned)

    ids: list[str] = []
    seen: set[str] = set()

    def push(raw: str):
        i = (raw or "").lower().strip()
        if not i or i in seen:
            return
        if not is_video_id(i):
            return
        seen.add(i)
        ids.append(i)

    for c in covers:
        push(c)

    # Secondary: title codes that look like DVD ids (when cover CDN missed)
    for code, _ in titles:
        push(code.lower())

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


def scrape(
    path: str,
    page: int = 1,
    locale: str = "zh",
    *,
    filters: str | None = None,
    sort: str | None = None,
):
    path = path.strip("/")
    locale = normalize_locale(locale)
    filters = (filters or "").strip() or None
    sort = (sort or "").strip() or None
    last = {
        "ok": False,
        "error": "no candidate succeeded",
        "path": path,
        "page": page,
        "locale": locale,
        "filters": filters,
        "sort": sort,
    }

    # Cloudflare often challenges bare GETs; same-site Referer unlocks search/list.
    _headers = {
        "Referer": "https://missav.ai/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    for url in candidate_urls(path, page, locale, filters=filters, sort=sort):
        try:
            r = requests.get(
                url,
                impersonate="chrome131",
                timeout=30,
                allow_redirects=True,
                headers=_headers,
            )
        except Exception as e:
            last = {
                "ok": False,
                "error": str(e),
                "url": url,
                "path": path,
                "page": page,
                "locale": locale,
                "filters": filters,
                "sort": sort,
            }
            continue

        if r.status_code != 200:
            last = {
                "ok": False,
                "error": f"status {r.status_code}",
                "url": str(r.url),
                "path": path,
                "page": page,
                "locale": locale,
                "filters": filters,
                "sort": sort,
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
                "filters": filters,
                "sort": sort,
            }
            continue

        return {
            "ok": True,
            "url": str(r.url),
            "path": path,
            "page": page,
            "locale": locale,
            "filters": filters or "",
            "sort": sort or "",
            "items": items,
            "count": len(items),
        }

    return last


def main():
    # argv: path page locale [filters] [sort]
    # filters/sort use "-" for empty
    path = sys.argv[1] if len(sys.argv) > 1 else "new"
    page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    locale = sys.argv[3] if len(sys.argv) > 3 else "zh"
    filters = sys.argv[4] if len(sys.argv) > 4 else ""
    sort = sys.argv[5] if len(sys.argv) > 5 else ""
    if filters in {"-", ""}:
        filters = None
    if sort in {"-", ""}:
        sort = None

    # genres/Creampie, makers/S1, search/keyword style
    if path.startswith("genres/"):
        rest = path.split("/", 1)[1]
        path = "genres/" + unquote(rest)
    elif path.startswith("makers/"):
        rest = path.split("/", 1)[1]
        path = "makers/" + unquote(rest)
    elif path.startswith("search/"):
        rest = path.split("/", 1)[1]
        # keep encoded form for URL; scrape re-encodes via path as-is
        path = "search/" + unquote(rest)
    elif path.startswith("actresses/"):
        rest = path.split("/", 1)[1]
        path = "actresses/" + unquote(rest)

    result = scrape(path, page, locale, filters=filters, sort=sort)
    # Binary UTF-8 write — avoids Windows GBK console mangling CJK JSON
    payload = json.dumps(result, ensure_ascii=False).encode("utf-8") + b"\n"
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
