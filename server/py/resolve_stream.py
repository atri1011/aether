#!/usr/bin/env python3
"""Resolve surrit m3u8 from MissAV detail HTML via TLS impersonation."""
from __future__ import annotations

import json
import re
import sys

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)


UA_IMPERSONATE = "chrome131"


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


def resolve(video_id: str):
    errors = []
    for url in candidate_urls(video_id):
        try:
            r = requests.get(
                url,
                impersonate=UA_IMPERSONATE,
                timeout=20,
                allow_redirects=True,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                },
            )
            if r.status_code != 200 or len(r.text) < 5000:
                errors.append(f"{url} -> {r.status_code}/{len(r.text)}")
                continue
            parsed = parse(r.text)
            if parsed:
                parsed["ok"] = True
                parsed["sourceUrl"] = str(r.url)
                return parsed
            errors.append(f"{url} -> parse miss ({len(r.text)}b)")
        except Exception as e:
            errors.append(f"{url} -> {e}")
    return {"ok": False, "error": "stream resolve failed", "details": "; ".join(errors[:10])}


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
