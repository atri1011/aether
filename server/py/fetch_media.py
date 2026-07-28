#!/usr/bin/env python3
"""Fetch surrit/fourhoi media with Chrome TLS impersonation. stdout = raw bytes."""
from __future__ import annotations

import sys

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
    r = requests.get(
        url,
        # Align with media_server / list scrapers (OPT-18)
        impersonate="chrome124",
        timeout=45,
        headers={
            "Referer": "https://missav.ws/",
            "Origin": "https://missav.ws",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        },
        allow_redirects=True,
        # Force IPv4 — dual-stack CF AAAA often RST (curl 35) on CN paths
        curl_options=CURL_OPTS or None,
    )
    # write status on stderr for node
    sys.stderr.write(f"STATUS {r.status_code}\n")
    sys.stderr.write(f"CTYPE {r.headers.get('content-type', '')}\n")
    if r.status_code != 200:
        sys.stderr.write(r.text[:300])
        sys.exit(1)
    sys.stdout.buffer.write(r.content)
    sys.exit(0)


if __name__ == "__main__":
    main()
