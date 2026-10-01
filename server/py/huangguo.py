#!/usr/bin/env python3
"""Huangguo's public AI-drama website only; no accounts, legacy API or preview fallback."""
from __future__ import annotations

import base64
import ipaddress
import json
import re
import socket
import sys
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from curl_cffi import CurlOpt, requests
from curl_opts import CURL_OPTS

ORIGIN = "https://huangguoai.com"
PAGE_SIZE = 24
COVER_HOSTS = {"pic.wirqed.cn"}
MEDIA_HOSTS = {"yd-hls.tktjpm.cn", "tp3.wirqed.cn"}
HOSTS = {"page": {"huangguoai.com"}, "cover": COVER_HOSTS, "media": MEDIA_HOSTS}
LIMITS = {"page": 2 * 1024 * 1024, "cover": 8 * 1024 * 1024, "media": 32 * 1024 * 1024}


class ProviderError(Exception):
    def __init__(self, message, code="UPSTREAM"):
        super().__init__(message)
        self.code = code


def valid_url(url, kind):
    try:
        p = urlparse(url)
        return (len(url) <= 8192 and p.scheme == "https" and p.hostname in HOSTS[kind]
                and p.port in (None, 443) and not p.username and not p.password
                and not p.fragment and not any(ord(c) < 33 for c in url))
    except (ValueError, TypeError, KeyError):
        return False


_dns_cache = {}  # At most the four fixed source hosts; failures are never cached.


def fallback_addresses(host):
    if host not in set().union(*HOSTS.values()):
        raise ProviderError("Unsupported DNS host")
    cached = _dns_cache.get(host)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    # Same fixed, TLS-verified DoH endpoint as the authorized Go source. The resolver
    # is a trusted bootstrap, never a source-supplied URL; redirects remain disabled.
    r = requests.get(f"https://dns.alidns.com/resolve?name={host}&type=A",
                     headers={"Accept": "application/dns-json"}, timeout=4,
                     allow_redirects=False, stream=True, curl_options=CURL_OPTS or None)
    try:
        if r.status_code != 200 or int(r.headers.get("content-length") or 0) > 65536:
            raise ProviderError("Public DNS fallback unavailable")
        chunks, size = [], 0
        for chunk in r.iter_content(chunk_size=16384):
            size += len(chunk)
            if size > 65536:
                raise ProviderError("Invalid DNS response size")
            chunks.append(chunk)
        data = json.loads(b"".join(chunks))
        if data.get("Status") != 0:
            raise ProviderError("Public DNS fallback unavailable")
        answers = [a for a in data.get("Answer", []) if a.get("type") == 1]
        addresses = sorted({a["data"] for a in answers})
        if not addresses or any(not ipaddress.IPv4Address(a).is_global for a in addresses):
            raise ProviderError("Source address is not public")
        ttl = max(1, min(300, *(int(a.get("TTL", 1)) for a in answers)))
        _dns_cache[host] = (time.monotonic() + ttl, addresses)
        return addresses
    finally:
        r.close()


def public_addresses(host):
    try:
        addresses = sorted({x[4][0] for x in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
    except socket.gaierror:
        addresses = []
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        return fallback_addresses(host)
    return addresses


def fetch_source(url, kind="page", *, stream=False, range_header=None):
    """Validate every redirect before connecting; pin resolved IPs to prevent rebinding."""
    limit = 512 * 1024 * 1024 if stream else LIMITS[kind]
    for _ in range(5):
        if not valid_url(url, kind):
            raise ProviderError("Unsupported Huangguo source URL")
        host = urlparse(url).hostname
        addresses = public_addresses(host)
        addresses = [f"[{a}]" if ":" in a else a for a in addresses]
        options = dict(CURL_OPTS or {})
        options[CurlOpt.RESOLVE] = [f"{host}:443:{','.join(addresses)}"]
        options[CurlOpt.PROXY] = ""  # Environment proxies would bypass the pinned destination.
        headers = {"Referer": ORIGIN + "/", "Origin": ORIGIN, "Accept": "*/*",
                   "Accept-Language": "zh-CN,zh;q=0.9"}
        if range_header:
            if not re.fullmatch(r"bytes=(?:\d+-\d*|-\d+)", range_header):
                raise ProviderError("Invalid byte range", "CONFIG")
            headers["Range"] = range_header
        r = requests.get(url, headers=headers, impersonate="chrome124", timeout=35,
                         allow_redirects=False, stream=True, curl_options=options)
        if r.status_code in (301, 302, 303, 307, 308):
            location = r.headers.get("location")
            r.close()
            if not location:
                raise ProviderError("Invalid source redirect")
            url = urljoin(url, location)
            continue
        if r.status_code not in (200, 206):
            status = r.status_code
            r.close()
            raise ProviderError("Source item not found" if status == 404 else "Huangguo source unavailable",
                                "NOT_FOUND" if status == 404 else "UPSTREAM")
        try:
            if int(r.headers.get("content-length") or 0) > limit:
                raise ProviderError("Source response too large")
            if stream:
                return r
            chunks, size = [], 0
            for chunk in r.iter_content(chunk_size=65536):
                size += len(chunk)
                if size > limit:
                    raise ProviderError("Source response too large")
                chunks.append(chunk)
            r.content = b"".join(chunks)
            return r
        except Exception:
            r.close()
            raise
        finally:
            if not stream:
                r.close()
    raise ProviderError("Too many source redirects")


def positive(value, maximum):
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]*", str(value)) or int(value) > maximum:
        raise ProviderError("Invalid drama identifier or page", "CONFIG")
    return int(value)


def summary(item):
    if not isinstance(item, dict):
        raise ProviderError("Invalid source drama")
    drama_id = str(positive(item.get("id"), 999999999999))
    title = item.get("title")
    cover = item.get("cover", item.get("coverSrc", ""))
    if not isinstance(title, str) or not title.strip() or not isinstance(cover, str):
        raise ProviderError("Incomplete source drama")
    cover = urljoin(ORIGIN, cover) if cover else ""
    if cover and not valid_url(cover, "cover"):
        raise ProviderError("Unsupported Huangguo cover host")
    out = {"id": drama_id, "title": title.strip()[:500], "coverUrl": cover,
           "description": str(item.get("description") or "")[:10000]}
    count = item.get("total_episodes") or item.get("episode_count")
    if count is not None:
        try:
            out["episodeCount"] = positive(count, 10000)
        except ProviderError:
            pass
    if "is_finished" in item:
        out["status"] = "completed" if item["is_finished"] in (True, 1, "1", "true") else "ongoing"
    return out


def parse_list(payload, page):
    if not isinstance(payload, dict) or payload.get("status") != 1:
        raise ProviderError("Invalid Huangguo catalog response")
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ProviderError("Invalid Huangguo catalog data")
    pagination = data.get("pagination")
    if not isinstance(pagination, dict) or pagination.get("page") != page or pagination.get("size") != PAGE_SIZE:
        raise ProviderError("Invalid Huangguo pagination")
    items = [summary(item) for item in data["items"]]
    if len(items) > PAGE_SIZE:
        raise ProviderError("Invalid Huangguo page size")
    total = pagination.get("total")
    pages = pagination.get("pages")
    if not isinstance(total, int) or total < 0 or not isinstance(pages, int) or pages < 0:
        raise ProviderError("Invalid Huangguo pagination totals")
    return {"items": items, "page": page, "pageSize": PAGE_SIZE, "hasMore": page < pages, "total": total}


class DramaHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_data = False
        self.data_text = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script" and a.get("id") == "videoInitialData":
            self.in_data = True
        if tag == "a" and "hg-web-play__ep" in a.get("class", "").split():
            self.links.append(a)

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_data = False

    def handle_data(self, data):
        if self.in_data:
            self.data_text.append(data)


def parse_page(markup, drama_id):
    parser = DramaHTML()
    parser.feed(markup)
    try:
        data = json.loads("".join(parser.data_text))
    except (ValueError, TypeError):
        raise ProviderError("Huangguo playback metadata unavailable")
    if not isinstance(data, dict) or str(data.get("id")) != drama_id:
        raise ProviderError("Huangguo returned a different drama")
    crumbs = data.get("breadcrumb")
    if not isinstance(crumbs, list) or not any(isinstance(c, dict) and c.get("url") == "/ai-duanju/" for c in crumbs):
        raise ProviderError("Only AI short dramas are available", "NOT_FOUND")
    episodes = {}
    for link in parser.links:
        match = re.fullmatch(rf"/video/{re.escape(drama_id)}/(?:ep-([1-9][0-9]*)/)?", link.get("href", ""))
        if not match:
            continue
        number = int(match.group(1) or 1)
        if number > 10000 or (link.get("data-ep-id") and link["data-ep-id"] != str(number)):
            continue
        episodes[number] = {"id": f"ep-{number}", "number": number, "title": f"第 {number} 集"}
    if not episodes:
        raise ProviderError("Huangguo episode list unavailable")
    drama = summary(data)
    drama["episodeCount"] = len(episodes)
    return data, {"drama": drama, "episodes": [episodes[n] for n in sorted(episodes)]}


def parse_resolve(markup, drama_id, episode):
    data, detail = parse_page(markup, drama_id)
    if not any(ep["number"] == episode for ep in detail["episodes"]):
        raise ProviderError("Episode not found", "NOT_FOUND")
    if str(data.get("ep")) != str(episode):
        raise ProviderError("Requested episode is unavailable", "EPISODE_UNAVAILABLE")
    # Never use another episode, previewSrc, videoApi or account/session APIs.
    sources = data.get("epPlaySrcs")
    source = sources.get(str(episode)) if isinstance(sources, dict) else None
    source = source or data.get("videoSrc")
    if not isinstance(source, str) or not source:
        raise ProviderError("Episode is paid or unavailable from the public source", "EPISODE_UNAVAILABLE")
    url = urljoin(ORIGIN, source)
    if not valid_url(url, "media"):
        raise ProviderError("Unsupported Huangguo playback host")
    path = urlparse(url).path.lower()
    media_type = "hls" if path.endswith(".m3u8") else "mp4" if path.endswith(".mp4") else None
    if not media_type:
        raise ProviderError("Unsupported Huangguo playback format")
    return {"url": url, "type": media_type}


def scrape(body):
    try:
        mode = body.get("mode", "list")
        if mode == "list":
            page = positive(body.get("page", 1), 10000)
            r = fetch_source(f"{ORIGIN}/api/videos/category/ai-duanju?sort=hot&page={page}&size={PAGE_SIZE}")
            result = parse_list(json.loads(r.content), page)
        elif mode == "cover":
            r = fetch_source(body.get("url", ""), "cover")
            result = {"base64": base64.b64encode(r.content).decode("ascii")}
        elif mode in ("detail", "resolve"):
            drama_id = str(positive(body.get("id"), 999999999999))
            episode = positive(body.get("episode", 1), 10000)
            path = f"/detail/{drama_id}/" if mode == "detail" else f"/video/{drama_id}/ep-{episode}/"
            r = fetch_source(ORIGIN + path)
            # A redirect to another episode may never be accepted, even if its player works.
            final_path = urlparse(str(r.url)).path
            expected = {f"/video/{drama_id}/ep-{episode}/"}
            if episode == 1:
                expected.add(f"/video/{drama_id}/")
            if mode == "resolve" and final_path not in expected:
                raise ProviderError("Requested episode is unavailable", "EPISODE_UNAVAILABLE")
            markup = r.content.decode("utf-8")
            result = parse_page(markup, drama_id)[1] if mode == "detail" else parse_resolve(markup, drama_id, episode)
        else:
            raise ProviderError("Unknown drama operation", "CONFIG")
        return {"ok": True, **result}
    except ProviderError as e:
        return {"ok": False, "error": str(e), "code": e.code}
    except Exception:
        return {"ok": False, "error": "Huangguo source could not be read", "code": "UPSTREAM"}


if __name__ == "__main__":
    print(json.dumps(scrape(json.loads(sys.argv[1])), ensure_ascii=False))
