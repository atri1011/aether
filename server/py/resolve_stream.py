#!/usr/bin/env python3
"""Resolve surrit m3u8 from MissAV detail HTML via TLS impersonation.

OPT-18: rotate JA3 fingerprints (chrome124 / Safari / chrome131) — list/actress
scrapers already do this because chrome131 is soft-blocked on some MissAV paths.

MissAV detail pages live under ephemeral ``/dm{N}/…`` prefixes. Recombee item
values expose that shard as ``dm`` (integer). Datacenter IPs often get CF 403
on bare ``/{id}`` while ``/dm{N}/{id}`` still serves the real player HTML —
so callers should pass ``dm`` whenever meta is known.
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

from curl_opts import CURL_OPTS  # type: ignore


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

_UUID_RE = (
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
)


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
    """UUID sits just before ``/seek/`` in sprite URLs (often JSON-escaped)."""
    m = re.search(
        rf"surrit\.com(?:\\+/|/)({_UUID_RE})(?:\\+/|/)seek",
        html,
        re.I,
    )
    if not m:
        # Legacy: first bare "seek" window (fragile if "seek" appears earlier).
        idx = html.find("seek")
        if idx < 40:
            return None
        slice_ = html[max(0, idx - 80) : idx]
        m = re.search(rf"({_UUID_RE})", slice_, re.I)
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
        rf"https?://(?:[\w-]+\.)?surrit\.com/({_UUID_RE})/playlist\.m3u8",
        html,
        re.I,
    )
    if m:
        return {
            "uuid": m.group(1),
            "masterUrl": m.group(0).replace("http://", "https://"),
            "method": "loose-url",
        }
    # JSON-escaped or path-only surrit UUID (seek / playlist / source).
    m = re.search(
        rf"surrit\.com(?:\\+/|/)({_UUID_RE})",
        html,
        re.I,
    )
    if not m:
        return None
    uuid = m.group(1)
    return {
        "uuid": uuid,
        "masterUrl": f"https://surrit.com/{uuid}/playlist.m3u8",
        "method": "surrit-uuid",
    }


def parse(html: str):
    return extract_packed(html) or extract_seek(html) or extract_loose(html)


def _looks_like_challenge(html: str) -> bool:
    """True when body is a CF interstitial / empty shell, not a real detail page.

    Datacenter IPs often get HTTP 200 + ~70KB obfuscated JS (``__CF$cv$params``)
    with no ``<title>`` / missav chrome. Old detector only scanned the first 4KB
    for ``just a moment``, so those shells were treated as parse misses and
    fingerprint rotation never ran.
    """
    if not html:
        return True
    # Real detail pages always embed player CDN assets or packed source list.
    if "surrit" in html or "fourhoi.com" in html or "'m3u8" in html:
        return False
    low = html.lower()
    if any(
        m in low
        for m in (
            "challenge-platform",
            "cf-browser-verification",
            "just a moment",
            "turnstile",
            "cdn-cgi/challenge",
            "attention required",
            "__cf$cv$params",
        )
    ):
        return True
    if len(html) < 5000:
        return True
    # Soft-block shell: long enough to pass size checks but no site chrome.
    if len(html) < 120_000 and "<title" not in low and "missav" not in low:
        return True
    # Obfuscated challenge: big inline script blob, almost no real markup.
    if len(html) < 100_000 and low.count("<script") >= 1 and low.count("<a ") < 3:
        return True
    return False


def _normalize_dm(dm) -> int | None:
    """Recombee ``values.dm`` → positive int, or None when missing/zero."""
    if dm is None or dm == "":
        return None
    try:
        n = int(dm)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def candidate_urls(video_id: str, dm: int | None = None):
    """Build detail URL candidates; known Recombee ``dm`` shard first.

    Hardcoded dm1/dm14/… mirrors are *not* used — those IDs are per-title
    shards from Recombee, not global path aliases. Guessing wrong ones only
    burns CF budget on ~70KB challenge shells.
    """
    bases = [
        "https://missav.ws",
        "https://missav.ai",
    ]
    # ``cn`` is the Hans locale path MissAV actually serves (not only ``zh``).
    langs = ["", "cn", "en", "zh", "ja"]
    dm_n = _normalize_dm(dm)
    urls: list[str] = []

    def add(base: str, *parts: str) -> None:
        segs = [base.rstrip("/"), *[p for p in parts if p]]
        urls.append("/".join(segs))

    # 1) Known shard — highest hit rate from VPS / datacenter IPs.
    if dm_n:
        shard = f"dm{dm_n}"
        for base in bases:
            for lang in langs:
                add(base, shard, lang, video_id)

    # 2) Bare + locale — residential IPs often 302 → /dm{N}/… here.
    for base in bases:
        for lang in langs:
            add(base, lang, video_id)

    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _fetch_html(url: str) -> tuple[str | None, str]:
    """Try JA3 profiles until we get real detail HTML. Returns (html|None, err|finalUrl)."""
    last_err = "request failed"
    for impersonate in IMPERSONATE_CANDIDATES:
        try:
            r = requests.get(
                url,
                impersonate=impersonate,
                timeout=20,
                allow_redirects=True,
                headers=DEFAULT_HEADERS,
                # Force IPv4 — dual-stack CF AAAA often RST (curl 35) on CN paths
                curl_options=CURL_OPTS or None,
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


def resolve(video_id: str, dm=None):
    errors = []
    dm_n = _normalize_dm(dm)
    for url in candidate_urls(video_id, dm_n):
        html, meta = _fetch_html(url)
        if html is None:
            errors.append(f"{url} -> {meta}")
            continue
        parsed = parse(html)
        if parsed:
            parsed["ok"] = True
            parsed["sourceUrl"] = meta  # final URL from successful fetch
            if dm_n:
                parsed["dm"] = dm_n
            return parsed
        # Got non-challenge HTML without a stream — rare; keep trying candidates.
        errors.append(f"{url} -> parse miss ({len(html)}b)")
    return {
        "ok": False,
        "error": "stream resolve failed",
        "details": "; ".join(errors[:10]),
    }


def main():
    if len(sys.argv) < 2:
        print(
            json.dumps(
                {"ok": False, "error": "usage: resolve_stream.py <id> [dm]"}
            )
        )
        sys.exit(1)
    video_id = sys.argv[1].strip()
    dm_arg = sys.argv[2] if len(sys.argv) > 2 else None
    result = resolve(video_id, dm=dm_arg)
    # ensure utf-8 stdout on windows
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
