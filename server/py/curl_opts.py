"""Shared curl_cffi options for outbound MissAV / CDN fetches.

Cloudflare dual-stack hosts (missav.ai / missav.ws) advertise AAAA records.
On some networks (notably CN ISP paths) the IPv6 handshake is RST mid-flight,
which surfaces as curl error 35:

  Failed to perform, curl: (35) Recv failure: Connection was reset

Forcing IPv4 avoids the broken path while keeping chrome impersonation.
"""
from __future__ import annotations

try:
    from curl_cffi import CurlOpt

    # CURL_IPRESOLVE_V4 == 1 (see libcurl CURLOPT_IPRESOLVE)
    CURL_OPTS: dict = {CurlOpt.IPRESOLVE: 1}
except ImportError:  # pragma: no cover — import fails only if curl_cffi missing
    CURL_OPTS = {}
