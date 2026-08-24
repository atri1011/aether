#!/usr/bin/env python3
"""External Chinese-subtitle lookup by video code (SUB-01).

Two sources, tried in this order:

  1. Xunlei public subtitle oracle — JSON, no key, human-uploaded .srt keyed by
     release code. Highest quality (real translations, correct timing) and it
     reports `duration`, which lets the caller reject out-of-sync uploads.
  2. SubtitleCat — HTML scrape, two hops (search page → subtitle page). Machine
     translations, so it only fills gaps Xunlei misses.

Search returns metadata only; `fetch_text` pulls one .srt and decodes it. That
split keeps the watch-page probe cheap — bytes move only when a track is used.

CLI (one-shot fallback for pybridge):
    python subtitles.py search <code> [durationSec]
    python subtitles.py fetch <url>
"""
from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urljoin

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

from curl_opts import CURL_OPTS  # type: ignore

XUNLEI_API = "https://api-shoulei-ssl.xunlei.com/oracle/subtitle"
SUBTITLECAT_BASE = "https://subtitlecat.com"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
IMPERSONATE = "chrome124"

# Subtitle payloads may only come from these hosts. Enforced again in Node, but
# keeping it here means the one-shot CLI path is equally safe.
ALLOW_SUFFIXES = (
    "xunlei.com",
    "geilijiasu.com",
    "subtitlecat.com",
)

# Whole .srt files are small; anything larger is not a subtitle.
MAX_SUBTITLE_BYTES = 2 * 1024 * 1024
SEARCH_TIMEOUT = 20
FETCH_TIMEOUT = 25
# SubtitleCat needs one request per result row — cap the fan-out.
SUBTITLECAT_MAX_PAGES = 4

_SESSION = requests.Session(curl_options=CURL_OPTS or None)


def allowed_url(url: str) -> bool:
    """True when `url` points at a known subtitle host over http(s)."""
    try:
        from urllib.parse import urlparse

        u = urlparse(url)
        if u.scheme not in ("http", "https"):
            return False
        host = (u.hostname or "").lower()
        return any(host == s or host.endswith("." + s) for s in ALLOW_SUFFIXES)
    except Exception:
        return False


def _get(url: str, **kw):
    return _SESSION.get(
        url,
        impersonate=IMPERSONATE,
        headers={
            "User-Agent": UA,
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        allow_redirects=True,
        **kw,
    )


# ---------------------------------------------------------------- code / text

_CODE_RE = re.compile(r"^([A-Za-z]{2,6})[-_ ]?(\d{2,5})$")


def normalize_code(raw: str) -> str:
    """`stars-500-chinese-subtitle` → `STARS-500`.

    MissAV ids append variant suffixes and drop the dash inconsistently; the
    subtitle sources index on the canonical dashed release code.
    """
    s = str(raw or "").strip().lower()
    for suffix in (
        "-chinese-subtitle",
        "-english-subtitle",
        "-uncensored-leak",
        "-uncensored",
    ):
        if s.endswith(suffix):
            s = s[: -len(suffix)]
    s = s.strip("-_ ")
    m = _CODE_RE.match(s)
    if m:
        return f"{m.group(1).upper()}-{m.group(2)}"
    return s.upper()


def _code_key(s: str) -> str:
    """Loose comparison key — `SSIS-001`, `ssis001`, `SSIS_001` all collapse."""
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def cjk_ratio(text: str) -> float:
    """Share of Han characters among CJK+latin letters. Chinese .srt ≈ 0.5–0.95."""
    han = 0
    latin = 0
    for ch in text:
        o = ord(ch)
        if 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF:
            han += 1
        elif ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            latin += 1
    total = han + latin
    if total < 40:
        return 0.0
    return han / total


# Ordered by likelihood for CJK subtitle uploads. gb18030 supersets GBK/GB2312
# and Big5 text usually fails utf-8 first, so this covers the field without a
# charset-detection dependency.
_ENCODINGS = ("utf-8-sig", "utf-8", "gb18030", "big5", "utf-16", "shift_jis")


def decode_subtitle(raw: bytes) -> tuple[str, str]:
    """Decode subtitle bytes → (text, encoding-name). Never raises."""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return raw.decode("utf-16"), "utf-16"
        except UnicodeDecodeError:
            pass
    for enc in _ENCODINGS:
        try:
            text = raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        # A wrong-but-lenient codec betrays itself with replacement chars.
        if "�" in text:
            continue
        return text, enc
    return raw.decode("utf-8", "replace"), "utf-8/replace"


# ---------------------------------------------------------------------- xunlei


def _xunlei_search(code: str) -> list[dict]:
    try:
        r = _get(f"{XUNLEI_API}?name={quote(code)}", timeout=SEARCH_TIMEOUT)
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []
    if not isinstance(data, dict) or data.get("code") != 0:
        return []

    out: list[dict] = []
    for row in data.get("data") or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "")
        ext = str(row.get("ext") or "").lower()
        if not url or not allowed_url(url):
            continue
        if ext not in ("srt", "ass", "ssa", "vtt"):
            continue
        # ms → s; 0 means the uploader never reported one.
        dur_ms = row.get("duration")
        try:
            duration = round(float(dur_ms) / 1000) if dur_ms else 0
        except (TypeError, ValueError):
            duration = 0
        out.append(
            {
                "source": "xunlei",
                "sourceId": str(row.get("gcid") or row.get("cid") or url)[:64],
                "name": str(row.get("name") or f"{code}.{ext}"),
                "url": url,
                "ext": ext,
                "durationSec": duration,
                # Xunlei never labels language; these uploads are ~always zh.
                "lang": "zh",
                "note": str(row.get("extra_name") or ""),
            }
        )
    return out


# ----------------------------------------------------------------- subtitlecat

_SC_ROW_RE = re.compile(
    r'<td>\s*<a\s+href="(?P<href>subs/[^"]+\.html)"[^>]*>(?P<title>[^<]+)</a>',
    re.I,
)
# <span>Chinese (Simplified)</span> … href="/subs/253/X-zh-CN.srt"
_SC_DL_RE = re.compile(
    r'<span>\s*(?P<lang>Chinese \((?:Simplified|Traditional)\))\s*</span>\s*'
    r'<span>\s*<a[^>]+href="(?P<href>[^"]+\.srt)"',
    re.I,
)


def _subtitlecat_pages(code: str) -> list[tuple[str, str]]:
    """Search page → [(subtitle page url, row title)] limited to code matches."""
    try:
        r = _get(
            f"{SUBTITLECAT_BASE}/index.php?search={quote(code)}",
            timeout=SEARCH_TIMEOUT,
        )
        if r.status_code != 200:
            return []
        html = r.text
    except Exception:
        return []

    want = _code_key(code)
    pages: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in _SC_ROW_RE.finditer(html):
        title = m.group("title").strip()
        # Rows are fuzzy matches; keep only ones actually carrying the code.
        if want not in _code_key(title):
            continue
        url = urljoin(SUBTITLECAT_BASE + "/", m.group("href"))
        if url in seen:
            continue
        seen.add(url)
        pages.append((url, title))
        if len(pages) >= SUBTITLECAT_MAX_PAGES:
            break
    return pages


def _subtitlecat_page_tracks(page_url: str, title: str) -> list[dict]:
    try:
        r = _get(page_url, timeout=SEARCH_TIMEOUT)
        if r.status_code != 200:
            return []
        html = r.text
    except Exception:
        return []

    out: list[dict] = []
    for m in _SC_DL_RE.finditer(html):
        href = m.group("href")
        url = urljoin(SUBTITLECAT_BASE + "/", href)
        if not allowed_url(url):
            continue
        simplified = "simplified" in m.group("lang").lower()
        out.append(
            {
                "source": "subtitlecat",
                "sourceId": href.strip("/")[:64],
                "name": f"{title} ({'简体' if simplified else '繁体'})",
                "url": url,
                "ext": "srt",
                "durationSec": 0,
                "lang": "zh-CN" if simplified else "zh-TW",
                # Surfaced in the UI: these are machine translations.
                "note": "machine-translated",
            }
        )
    return out


def _subtitlecat_search(code: str) -> list[dict]:
    pages = _subtitlecat_pages(code)
    if not pages:
        return []
    out: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(4, len(pages))) as pool:
        for tracks in pool.map(lambda p: _subtitlecat_page_tracks(*p), pages):
            out.extend(tracks)
    return out


# ------------------------------------------------------------------ public API


def search(code: str, duration_sec: int = 0) -> dict:
    """Find Chinese subtitle candidates for a release code.

    `duration_sec` (the video's real length) is not a filter — it is returned
    per candidate so the caller can rank exact-length matches first.
    """
    norm = normalize_code(code)
    if not norm:
        return {"ok": False, "error": "code required"}

    # Both sources are independent network calls — overlap them.
    with ThreadPoolExecutor(max_workers=2) as pool:
        fx = pool.submit(_xunlei_search, norm)
        fs = pool.submit(_subtitlecat_search, norm)
        items = list(fx.result()) + list(fs.result())

    # Same file often appears under several gcids; first wins.
    seen: set[str] = set()
    unique: list[dict] = []
    for it in items:
        key = it["url"]
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)

    return {
        "ok": True,
        "code": norm,
        "durationSec": int(duration_sec or 0),
        "items": unique,
    }


def fetch_text(url: str) -> dict:
    """Download one subtitle file and decode it to text."""
    if not allowed_url(url):
        return {"ok": False, "error": "url not allowed"}
    try:
        r = _get(url, timeout=FETCH_TIMEOUT)
    except Exception as e:
        return {"ok": False, "error": f"fetch failed: {e}"}
    if r.status_code != 200:
        return {"ok": False, "error": f"upstream {r.status_code}"}

    raw = r.content or b""
    if not raw:
        return {"ok": False, "error": "empty body"}
    if len(raw) > MAX_SUBTITLE_BYTES:
        return {"ok": False, "error": "subtitle too large"}

    text, encoding = decode_subtitle(raw)
    return {
        "ok": True,
        "text": text,
        "encoding": encoding,
        "bytes": len(raw),
        "cjkRatio": round(cjk_ratio(text), 3),
    }


def main() -> None:
    argv = sys.argv[1:]
    mode = (argv[0] if argv else "").lower()
    try:
        if mode == "search":
            code = argv[1] if len(argv) > 1 else ""
            try:
                duration = int(argv[2]) if len(argv) > 2 and argv[2] not in ("-", "") else 0
            except ValueError:
                duration = 0
            out = search(code, duration)
        elif mode == "fetch":
            out = fetch_text(argv[1] if len(argv) > 1 else "")
        else:
            out = {"ok": False, "error": f"unknown mode: {mode}"}
    except Exception as e:
        out = {"ok": False, "error": str(e)}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
