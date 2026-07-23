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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote, unquote, urlencode

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

# Persist last-good host/path patterns so cold scrapes try winners first.
_WINNER_FILE = Path(__file__).resolve().parent.parent.parent / ".cache" / "aether" / "scrape-url-winners.json"
_winner_hosts: list[str] = []
_winner_patterns: list[str] = []


def _load_winners() -> None:
    global _winner_hosts, _winner_patterns
    try:
        raw = json.loads(_WINNER_FILE.read_text(encoding="utf-8"))
        hosts = raw.get("hosts") or []
        patterns = raw.get("patterns") or []
        if isinstance(hosts, list):
            _winner_hosts = [str(h) for h in hosts if h][:6]
        if isinstance(patterns, list):
            _winner_patterns = [str(p) for p in patterns if p][:8]
    except Exception:
        _winner_hosts = []
        _winner_patterns = []


def _remember_winner(request_url: str, final_url: str | None = None) -> None:
    """Record stable host + locale prefix from the *request* URL (not ephemeral dm*).

    MissAV often redirects /genres/X → /dm123/genres/X. Those dm IDs are
    session-ish and 403 later — never store pure-digit dm mirrors as winners.
    """
    global _winner_hosts, _winner_patterns
    try:
        from urllib.parse import urlparse

        # Prefer the URL we requested (stable). Fall back to final only for host.
        u = urlparse(request_url or final_url or "")
        host = f"{u.scheme}://{u.netloc}" if u.netloc else ""
        segs = [s for s in (u.path or "").split("/") if s]

        # Strip list tail: genres/X, makers/X, search/X, actresses/X, or last segment
        cut = len(segs)
        for i, s in enumerate(segs):
            if s in {"genres", "makers", "search", "actresses"}:
                cut = i
                break
        else:
            if segs:
                cut = len(segs) - 1  # bare /new style
        prefix_segs = segs[:cut]

        # Drop ephemeral mirror ids: dm + digits only (dm133, dm2208642…)
        stable = [
            s
            for s in prefix_segs
            if not re.fullmatch(r"dm\d+", s, re.I)
        ]
        prefix = "/".join(stable)
        pattern = f"{host}/{prefix}" if prefix else host

        if host:
            _winner_hosts = [host] + [h for h in _winner_hosts if h != host]
            _winner_hosts = _winner_hosts[:4]
        if pattern:
            _winner_patterns = [pattern] + [p for p in _winner_patterns if p != pattern]
            # also purge any previously-saved ephemeral dm patterns
            _winner_patterns = [
                p
                for p in _winner_patterns
                if not re.search(r"/dm\d+(/|$)", p, re.I)
            ][:6]

        _WINNER_FILE.parent.mkdir(parents=True, exist_ok=True)
        _WINNER_FILE.write_text(
            json.dumps({"hosts": _winner_hosts, "patterns": _winner_patterns}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass


_load_winners()

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
    """Build listing URLs; put last-good hosts/patterns first (cold miss ~4s not ~25s)."""
    path = encode_path(path)
    loc = site_locale(locale)
    qs = build_query(page, filters, sort)
    qstr = ("?" + urlencode(qs)) if qs else ""

    # Prefer previously successful hosts, then defaults.
    default_hosts = ["https://missav.ws", "https://missav.ai"]
    hosts: list[str] = []
    for h in _winner_hosts + default_hosts:
        if h and h not in hosts:
            hosts.append(h)

    # Stable prefixes only — ephemeral dm+digits come from redirects, not requests.
    # Bare path often redirects to a working dm* and is the fastest cold hit.
    if loc == "cn":
        prefixes = [
            "",  # bare /genres/X → often redirects to live dm*
            "cn",
            "dm539/cn",
            "dm14/cn",
            "zh",
            "dm539",
        ]
    else:
        prefixes = [
            "en",
            "",
            "dm539/en",
            "dm14/en",
            "dm278/en",
        ]

    urls: list[str] = []
    seen: set[str] = set()

    def push(url: str) -> None:
        if url and url not in seen:
            seen.add(url)
            urls.append(url)

    # 1) Stable last-good patterns (never dm+digits)
    for pat in _winner_patterns:
        if re.search(r"/dm\d+(/|$)", pat, re.I):
            continue
        base = pat.rstrip("/")
        push(f"{base}/{path}{qstr}")

    # 2) Full matrix, winners-first host order
    for host in hosts:
        for pref in prefixes:
            if pref:
                push(f"{host}/{pref}/{path}{qstr}")
            else:
                push(f"{host}/{path}{qstr}")

    return urls


def id_specificity(raw: str) -> int:
    """Prefer MissAV variant slugs over bare DVD codes.

    On listing HTML, fourhoi cover paths carry the full product slug
    (e.g. ssis-001-chinese-subtitle) while the title line only shows the
    bare code (SSIS-001). Without this ranking, parse_items used to emit
    both and half the grid lost the 中文字幕 badge.
    """
    s = (raw or "").lower()
    score = 0
    if "chinese-subtitle" in s:
        score += 4
    if "english-subtitle" in s:
        score += 2
    if "uncensored" in s:
        score += 1
    return score


def normalize_id_for_filter(raw: str, filters: str | None) -> str:
    """When MissAV filter=chinese-subtitle (etc.), force the matching slug.

    Title-line codes are bare; under a subtitle filter the listed product is
    the subtitled variant even if the bare code is all we parsed.
    """
    i = (raw or "").lower().strip()
    if not i:
        return i
    f = (filters or "").strip().lower()
    bid = base_id(i)
    if f == "chinese-subtitle" and "chinese-subtitle" not in i:
        return f"{bid}-chinese-subtitle"
    if f == "english-subtitle" and "english-subtitle" not in i:
        return f"{bid}-english-subtitle"
    return i


def parse_duration_sec(text: str) -> int:
    """Parse MissAV badge times: H:MM:SS or M:SS → seconds."""
    s = (text or "").strip()
    m = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", s)
    if not m:
        return 0
    a, b, c = m.group(1), m.group(2), m.group(3)
    if c is not None:
        return int(a) * 3600 + int(b) * 60 + int(c)
    return int(a) * 60 + int(b)


def parse_items(html: str, filters: str | None = None) -> list[dict]:
    """Extract video cards only.

    Prefer fourhoi cover URLs (actual thumbnails on listing grids).
    Never trust bare page hrefs alone — footer links (madou, history, upload…)
    look like slugs and used to pollute the grid with blank covers.

    Dedup by base DVD code, keeping the most specific MissAV variant
    (chinese-subtitle / english-subtitle / uncensored-leak). This matches
    missav.ai card identity: one grid tile → one product slug.

    Also pulls duration from each thumbnail card badge (H:MM:SS). Actress
    names are not on list HTML — the Node layer enriches those via Recombee.
    """
    # Cover order ≈ listing order on missav pages
    covers = re.findall(r"https://fourhoi\.com/([a-z0-9\-]+)/cover-[nt]\.jpg", html, re.I)

    # Duration lives inside each `thumbnail group` card, near the cover.
    # Split by card root so we don't attach the next tile's badge to this id.
    duration_map: dict[str, int] = {}
    for block in re.split(r'class="thumbnail\s+group"', html)[1:]:
        cover_m = re.search(
            r"fourhoi\.com/([a-z0-9\-]+)/cover-[nt]\.jpg", block, re.I
        )
        if not cover_m:
            continue
        cid = cover_m.group(1).lower()
        dur_m = re.search(
            r'bg-opacity-75">\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*<', block
        )
        if not dur_m:
            dur_m = re.search(r">(\d{1,2}:\d{2}:\d{2})\s*<", block)
        if not dur_m:
            continue
        sec = parse_duration_sec(dur_m.group(1))
        if sec <= 0:
            continue
        duration_map[cid] = sec
        duration_map.setdefault(base_id(cid), sec)

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

    # base_id → (id, order) — keep first-seen order, upgrade specificity
    chosen: dict[str, tuple[str, int]] = {}
    order_n = 0

    def push(raw: str) -> None:
        nonlocal order_n
        i = normalize_id_for_filter((raw or "").lower().strip(), filters)
        if not i or not is_video_id(i):
            return
        bid = base_id(i)
        prev = chosen.get(bid)
        if prev is None:
            chosen[bid] = (i, order_n)
            order_n += 1
            return
        prev_id, prev_ord = prev
        if id_specificity(i) > id_specificity(prev_id):
            # Keep original grid position; only swap to the richer slug.
            chosen[bid] = (i, prev_ord)

    for c in covers:
        push(c)

    # Secondary: title codes when cover CDN missed this card
    for code, _ in titles:
        push(code.lower())

    ordered = sorted(chosen.values(), key=lambda t: t[1])
    items = []
    for i, _ in ordered:
        bid = base_id(i)
        title = title_map.get(i) or title_map.get(bid) or ""
        items.append(
            {
                "id": i,
                "title": title,
                # Media CDN uses bare code; subtitle/leak suffixes 404 on fourhoi
                "coverUrl": f"https://fourhoi.com/{bid}/cover-t.jpg",
                "durationSec": duration_map.get(i) or duration_map.get(bid) or 0,
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
    """Two-phase URL race — small burst first, expand only if needed.

    Serial 12-candidate loops burned ~25s on 403s. A huge parallel burst can
    also trip CF rate limits. Phase-1 races 4 high-priority URLs (~3–6s);
    phase-2 only runs if those all fail.
    """
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
        "Referer": "https://missav.ws/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    # Session only for sequential first hop (thread-safe); races use plain get.
    session = requests.Session()
    urls = candidate_urls(path, page, locale, filters=filters, sort=sort)
    if not urls:
        return last

    def try_one(url: str, timeout: float = 10, use_session: bool = False) -> dict:
        client = session if use_session else requests
        try:
            r = client.get(
                url,
                impersonate="chrome131",
                timeout=timeout,
                allow_redirects=True,
                headers=_headers,
            )
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "url": url,
                "requestUrl": url,
                "path": path,
                "page": page,
                "locale": locale,
                "filters": filters,
                "sort": sort,
            }

        if r.status_code != 200:
            return {
                "ok": False,
                "error": f"status {r.status_code}",
                "url": str(r.url),
                "requestUrl": url,
                "path": path,
                "page": page,
                "locale": locale,
                "filters": filters,
                "sort": sort,
            }

        items = parse_items(r.text, filters=filters)
        if not items:
            return {
                "ok": False,
                "error": "no items parsed",
                "url": str(r.url),
                "requestUrl": url,
                "path": path,
                "page": page,
                "locale": locale,
                "filters": filters,
                "sort": sort,
            }

        return {
            "ok": True,
            "url": str(r.url),
            "requestUrl": url,
            "path": path,
            "page": page,
            "locale": locale,
            "filters": filters or "",
            "sort": sort or "",
            "items": items,
            "count": len(items),
        }

    def race(batch: list[str], timeout: float) -> dict | None:
        nonlocal last
        if not batch:
            return None
        workers = min(3, len(batch))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(try_one, u, timeout): u for u in batch}
            for fut in as_completed(futures):
                result = fut.result()
                if result.get("ok") and result.get("items"):
                    _remember_winner(
                        str(result.get("requestUrl") or futures[fut]),
                        str(result.get("url") or ""),
                    )
                    for other in futures:
                        if other is not fut:
                            other.cancel()
                    return result
                last = result
        return None

    # Phase 0: single best URL first (lowest CF heat; often the winner)
    if urls:
        first = try_one(urls[0], timeout=12, use_session=True)
        if first.get("ok") and first.get("items"):
            _remember_winner(str(first.get("requestUrl") or urls[0]), str(first.get("url") or ""))
            return first
        last = first

    # Phase 1: small parallel race of next candidates
    phase1 = urls[1:4]
    hit = race(phase1, timeout=10)
    if hit:
        return hit

    # Phase 2: remaining in small waves (avoid rate-limit storms)
    rest = urls[4:]
    for i in range(0, len(rest), 3):
        hit = race(rest[i : i + 3], timeout=10)
        if hit:
            return hit

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
