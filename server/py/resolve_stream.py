#!/usr/bin/env python3
"""Resolve surrit m3u8 from MissAV detail HTML via TLS impersonation.

OPT-18: rotate JA3 fingerprints (chrome124 / Safari / chrome131) — list/actress
scrapers already do this because chrome131 is soft-blocked on some MissAV paths.
"""
from __future__ import annotations

import json
import re
import sys

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)


# Prefer profiles that currently pass MissAV CF; chrome131 last (often challenged).
IMPERSONATE_CANDIDATES = (
    "chrome124",
    "safari17_0",
    "chrome131",
)

DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://missav.ws/",
}

# Soft CF / edge blocks — try next fingerprint before giving up the URL.
_RETRY_STATUSES = {403, 429, 503, 520, 521, 522, 523, 524}


def extract_packed(html: str):
    m = re.search(r"'m3u8(.*?)video", html)
    if not m:
        return None
    parts = m.group(1).split("|")[::-1]
    if len(parts) < 9:
        return None
    scheme, host_a, host_b = parts[1], parts[2], parts[3]
    uuid = f"{parts[4]}-{parts[5]}-{parts[6]}-{parts[7]}-{parts[8]}"
    if not scheme or not host_a or "-" not in uuid:
        return None
    return {
        "uuid": uuid,
        "masterUrl": f"{scheme}://{host_a}.{host_b}/{uuid}/playlist.m3u8",
        "method": "packed-m3u8",
    }


def extract_seek(html: str):
    idx = html.find("seek")
    if idx < 40:
        return None
    slice_ = html[max(0, idx - 80) : idx]
    m = re.search(
        r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
        slice_,
        re.I,
    )
    if not m:
        return None
    uuid = m.group(1)
    return {
        "uuid": uuid,
        "masterUrl": f"https://surrit.com/{uuid}/playlist.m3u8",
        "method": "seek-uuid",
    }


def extract_loose(html: str):
    m = re.search(
        r"https?://(?:[\w-]+\.)?surrit\.com/([0-9a-f-]{36})/playlist\.m3u8",
        html,
        re.I,
    )
    if not m:
        return None
    return {
        "uuid": m.group(1),
        "masterUrl": m.group(0).replace("http://", "https://"),
        "method": "loose-url",
    }


def parse(html: str):
    return extract_packed(html) or extract_seek(html) or extract_loose(html)


def _looks_like_challenge(html: str) -> bool:
    """Cheap CF soft-block detector (HTTP 200 + challenge shell)."""
    if not html or len(html) < 5000:
        return True
    low = html[:4000].lower()
    if "just a moment" in low or "cf-browser-verification" in low:
        return True
    if "challenge-platform" in low and "missav" not in low:
        return True
    return False


def candidate_urls(video_id: str):
    bases = [
        "https://missav.ws",
        "https://missav.ai",
    ]
    langs = ["", "en", "zh", "ja"]
    dms = ["", "dm1", "dm14", "dm31", "dm54"]
    urls = []
    for base in bases:
        for dm in dms:
            for lang in langs:
                parts = [base]
                if dm:
                    parts.append(dm)
                if lang:
                    parts.append(lang)
                parts.append(video_id)
                urls.append("/".join(parts))
    # de-dupe preserve order
    seen = set()
    out = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _fetch_html(url: str) -> tuple[str | None, str]:
    """Try JA3 profiles until we get parseable HTML. Returns (html|None, err)."""
    last_err = "request failed"
    for impersonate in IMPERSONATE_CANDIDATES:
        try:
            r = requests.get(
                url,
                impersonate=impersonate,
                timeout=20,
                allow_redirects=True,
                headers=DEFAULT_HEADERS,
            )
        except Exception as e:
            last_err = f"{impersonate}: {e}"
            continue

        if r.status_code != 200:
            last_err = f"{impersonate}: {r.status_code}/{len(r.text)}"
            if r.status_code in _RETRY_STATUSES:
                continue
            break

        if _looks_like_challenge(r.text):
            last_err = f"{impersonate}: challenge/{len(r.text)}b"
            continue

        return r.text, str(r.url)

    return None, last_err


def resolve(video_id: str):
    errors = []
    for url in candidate_urls(video_id):
        html, meta = _fetch_html(url)
        if html is None:
            errors.append(f"{url} -> {meta}")
            continue
        parsed = parse(html)
        if parsed:
            parsed["ok"] = True
            parsed["sourceUrl"] = meta  # final URL from successful fetch
            return parsed
        errors.append(f"{url} -> parse miss ({len(html)}b)")
    return {
        "ok": False,
        "error": "stream resolve failed",
        "details": "; ".join(errors[:10]),
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: resolve_stream.py <id>"}))
        sys.exit(1)
    video_id = sys.argv[1].strip()
    result = resolve(video_id)
    # ensure utf-8 stdout on windows
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
