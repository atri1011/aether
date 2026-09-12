#!/usr/bin/env python3
"""Fetch surrit/fourhoi media with Chrome TLS impersonation. stdout = raw bytes."""
from __future__ import annotations

import sys
from urllib.parse import urlparse

try:
    from curl_cffi import requests
except ImportError:
    sys.stderr.write("curl_cffi missing\n")
    sys.exit(2)

from curl_opts import CURL_OPTS  # type: ignore


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: fetch_media.py <url>\n")
        sys.exit(1)
    url = sys.argv[1]
    origin = "https://whos.tv" if urlparse(url).hostname == "v.hersav.me" else "https://missav.ws"
    headers = {
        "Referer": origin + "/",
        "Origin": origin,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if len(sys.argv) > 2:
        headers["Range"] = sys.argv[2]
    r = requests.get(
        url,
        # Align with media_server / list scrapers (OPT-18)
        impersonate="chrome124",
        timeout=45,
        headers=headers,
        allow_redirects=True,
        # Force IPv4 — dual-stack CF AAAA often RST (curl 35) on CN paths
        curl_options=CURL_OPTS or None,
    )
    # write status on stderr for node
    sys.stderr.write(f"STATUS {r.status_code}\n")
    sys.stderr.write(f"CTYPE {r.headers.get('content-type', '')}\n")
    sys.stderr.write(f"RANGE {r.headers.get('content-range', '')}\n")
    sys.stderr.write(f"FINALURL {r.url}\n")
    if r.status_code not in (200, 206):
        sys.stderr.write(r.text[:300])
        sys.exit(1)
    sys.stdout.buffer.write(r.content)
    sys.exit(0)


if __name__ == "__main__":
    main()
