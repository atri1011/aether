#!/usr/bin/env python3
"""Scrape the two Huangguo (黄果) sources into JSON.

huangguoai.com (source id `huangguo-ai`, AI 短剧):
  GET /api/videos/category/{slug}?sort={hot|new}&page={n}&size={m}   JSON list
  GET /api/videos/{id}                                               JSON detail
  GET /api/tags                                                      JSON tag index
  GET /video/{id}/ep-{n}/                                            HTML, <script id="videoInitialData">
  GET /tag/{slug}/page/{n}/                                          HTML card grid (server-rendered)

huangguo.video (source id `huangguo-video`, 黄果剧场):
  GET /videos?category={all|1|2|3|4}&page={n}   HTML card grid
  GET /series/{code}                            HTML, episode list
  GET /video/{code}                             HTML, data-hls master playlist

Neither host needs a Chrome-150 fingerprint; curl_cffi with a rotating
impersonate target is enough. The list JSON ignores a ?ep= parameter, so each
episode playlist is read from that episode's own page. See docs/DEVELOPMENT.md 7.10.
"""
from __future__ import annotations

import html as html_lib
import json
import re
import sys
from typing import Any
from urllib.parse import quote, urljoin

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

from curl_opts import CURL_OPTS  # type: ignore

BASE_AI = "https://huangguoai.com"
BASE_VIDEO = "https://huangguo.video"

# Unsupported targets raise and fall through to the next fingerprint.
IMPERSONATE = ("chrome146", "chrome131", "chrome124", "safari17_0")

AI_HEADERS = {
    "Referer": f"{BASE_AI}/",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
VIDEO_HEADERS = {
    "Referer": f"{BASE_VIDEO}/",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

AI_CATEGORIES: list[dict[str, str]] = [
    {"slug": "ai-duanju", "titleZh": "AI成人短剧", "titleEn": "AI Drama"},
    {"slug": "ai-manju", "titleZh": "AI成人漫剧", "titleEn": "AI Manhua Drama"},
    {"slug": "ai-huanlian", "titleZh": "AI换脸", "titleEn": "AI Face Swap"},
    {"slug": "ai-mogai", "titleZh": "AI魔改", "titleEn": "AI Remix"},
]

VIDEO_CATEGORIES: list[dict[str, str]] = [
    {"slug": "all", "titleZh": "全部视频", "titleEn": "All videos"},
    {"slug": "1", "titleZh": "MV/音乐剧", "titleEn": "MV / Musical"},
    {"slug": "2", "titleZh": "短片", "titleEn": "Short film"},
    {"slug": "3", "titleZh": "连续剧", "titleEn": "Series"},
    {"slug": "4", "titleZh": "片段", "titleEn": "Clip"},
]

AI_PAGE_SIZE = 24
VIDEO_PAGE_SIZE = 20

_session = None


def _sess():
    global _session
    if _session is None:
        _session = requests.Session(curl_options=CURL_OPTS or None)
    return _session


def _clean(s: str) -> str:
    return html_lib.unescape(re.sub(r"\s+", " ", (s or "")).strip())


def _fetch(
    url: str,
    *,
    headers: dict | None = None,
    timeout: int = 35,
    missing_on_404: bool = False,
) -> str:
    last_err = "request failed"
    for impersonate in IMPERSONATE:
        try:
            r = _sess().get(
                url,
                headers=headers,
                timeout=timeout,
                impersonate=impersonate,
                allow_redirects=True,
            )
        except Exception as e:  # noqa: BLE001 - retry with the next fingerprint
            last_err = str(e)
            continue
        if r.status_code in {403, 429, 502, 503, 504, 520, 521, 522, 523, 524}:
            last_err = f"HTTP {r.status_code}"
            continue
        if r.status_code == 404 and missing_on_404:
            return ""
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code} for {url}")
        text = r.text or ""
        if re.search(r"<title>\s*Just a moment", text, re.I):
            last_err = "upstream verification page"
            continue
        return text
    raise RuntimeError(f"{last_err} for {url}")


def _fetch_json(url: str, *, headers: dict | None = None, timeout: int = 30) -> dict:
    text = _fetch(url, headers=headers, timeout=timeout)
    try:
        data = json.loads(text)
    except ValueError as e:
        raise RuntimeError(f"upstream did not return JSON: {e}") from e
    if not isinstance(data, dict):
        raise RuntimeError("upstream JSON was not an object")
    return data


def _abs(url: str, base: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("http"):
        return u
    return urljoin(base + "/", u.lstrip("/"))


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _duration_sec(value: Any) -> int:
    """Category JSON sends seconds; episode chips send m:ss or h:mm:ss."""
    text = str(value or "").strip()
    if not text:
        return 0
    if re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", text):
        parts = [int(p) for p in text.split(":")]
        while len(parts) < 3:
            parts.insert(0, 0)
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return _int(text)


def _ep_number(text: str) -> int:
    m = re.search(r"第\s*(\d+)\s*集", text or "")
    if m:
        return _int(m.group(1))
    m = re.search(r"(?:更新至|全)\s*(\d+)\s*集", text or "")
    return _int(m.group(1)) if m else 0


def _title_of(item: dict, locale: str) -> str:
    if str(locale or "").lower().startswith("en"):
        return item.get("titleEn") or item.get("titleZh") or ""
    return item.get("titleZh") or item.get("titleEn") or ""


def ai_category(slug: str) -> dict | None:
    s = str(slug or "").strip()
    return next((c for c in AI_CATEGORIES if c["slug"] == s), None)


def video_category(slug: str) -> dict | None:
    s = str(slug or "all").strip()
    return next((c for c in VIDEO_CATEGORIES if c["slug"] == s), None)


def map_ai_item(raw: dict, locale: str = "zh") -> dict:
    actors = []
    for a in raw.get("actors") or []:
        name = _clean(str(a.get("name") or "")) if isinstance(a, dict) else _clean(str(a))
        if name:
            actors.append(name)
    return {
        "id": str(raw.get("id") or ""),
        "title": _clean(str(raw.get("title") or "")),
        "cover": str(raw.get("cover") or ""),
        "description": _clean(str(raw.get("description") or "")),
        "durationSec": _duration_sec(raw.get("duration")),
        "episodeCount": _int(raw.get("episode_count") or raw.get("total_episodes")),
        "episodeLabel": "",
        "score": raw.get("score") if raw.get("score") not in (None, "") else None,
        "isFinished": bool(raw.get("is_finished")),
        "isOriginal": bool(raw.get("is_original")),
        "tags": [str(t) for t in (raw.get("tags") or []) if str(t).strip()],
        "actors": actors,
        "hot": _int(raw.get("hot")),
        "createdAt": str(raw.get("created_at") or ""),
    }


def scrape_ai_list(slug: str, sort: str = "hot", page: int = 1, locale: str = "zh") -> dict:
    cat = ai_category(slug)
    if not cat:
        return {"ok": False, "error": f"unknown ai category: {slug}"}
    s = "new" if str(sort or "").lower() == "new" else "hot"
    p = max(1, _int(page, 1))
    payload = _fetch_json(
        f"{BASE_AI}/api/videos/category/{quote(cat['slug'])}"
        f"?sort={s}&page={p}&size={AI_PAGE_SIZE}",
        headers=AI_HEADERS,
    )
    if _int(payload.get("status"), 1) != 1:
        return {"ok": False, "error": str(payload.get("msg") or "ai list failed")}
    data = payload.get("data") or {}
    pg = data.get("pagination") or {}
    pages = max(0, _int(pg.get("pages")))
    return {
        "ok": True,
        "category": cat["slug"],
        "title": _title_of(cat, locale),
        "sort": s,
        "page": _int(pg.get("page"), p) or p,
        "pageSize": AI_PAGE_SIZE,
        "maxPage": pages or None,
        "total": _int(pg.get("total")) if pg.get("total") is not None else None,
        "hasMore": bool(pages) and p < pages,
        "items": [map_ai_item(it, locale) for it in (data.get("items") or []) if isinstance(it, dict)],
        "source": "huangguo-ai",
    }


def scrape_ai_detail(video_id: str, locale: str = "zh") -> dict:
    vid = str(video_id or "").strip()
    if not vid:
        return {"ok": False, "error": "id required"}
    payload = _fetch_json(f"{BASE_AI}/api/videos/{quote(vid)}", headers=AI_HEADERS)
    if _int(payload.get("status"), 1) != 1:
        return {"ok": False, "error": str(payload.get("msg") or "ai detail failed")}
    raw = payload.get("data") or {}
    item = map_ai_item(raw, locale)
    episodes = []
    for ep in raw.get("episodes") or []:
        if not isinstance(ep, dict):
            continue
        num = _int(ep.get("ep_num"))
        if num <= 0:
            continue
        episodes.append(
            {
                "ep": num,
                "title": _clean(str(ep.get("title") or f"第{num}集")),
                "durationSec": _duration_sec(ep.get("duration")),
                "playable": _int(ep.get("status"), 1) == 1,
            }
        )
    episodes.sort(key=lambda e: e["ep"])
    item["episodes"] = episodes
    item["episodeCount"] = item["episodeCount"] or len(episodes)
    item["tagLinks"] = [
        {"name": _clean(str(t.get("name") or "")), "url": str(t.get("url") or "")}
        for t in (raw.get("tag_links") or [])
        if isinstance(t, dict)
    ]
    return {"ok": True, "item": item, "source": "huangguo-ai"}


def parse_ai_episode(html: str) -> dict | None:
    m = re.search(r'<script[^>]*id="videoInitialData"[^>]*>(.*?)</script>', html or "", re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def scrape_ai_episode(video_id: str, ep: int = 1, locale: str = "zh") -> dict:
    vid = str(video_id or "").strip()
    n = max(1, _int(ep, 1))
    if not vid:
        return {"ok": False, "error": "id required"}
    html = _fetch(f"{BASE_AI}/video/{quote(vid)}/ep-{n}/", headers=AI_HEADERS, missing_on_404=True)
    if not html:
        return {"ok": False, "code": "NOT_FOUND", "error": f"episode {n} not found"}
    data = parse_ai_episode(html)
    if not data:
        return {"ok": False, "error": "episode payload missing"}
    src = str(data.get("videoSrc") or "").strip()
    out = {
        "ok": bool(src),
        "ep": _int(data.get("ep"), n) or n,
        "title": _clean(str(data.get("title") or "")),
        "coverUrl": str(data.get("coverSrc") or ""),
        "stream": {"masterUrl": src} if src else None,
        "epPlaySrcs": {
            str(k): str(v).strip()
            for k, v in (data.get("epPlaySrcs") or {}).items()
            if str(v or "").strip()
        },
        "source": "huangguo-ai",
    }
    if not src:
        out["error"] = "no playable source"
    return out


def parse_ai_tag_page(html: str) -> tuple[list[dict], int, str]:
    """Tag grids are server-rendered: hg-drama-card blocks plus an hg-pager."""
    src = html or ""
    title = ""
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S)
    if m:
        title = _clean(re.sub(r"<[^>]+>", "", m.group(1)))

    pm = re.search(r'data-pages="(\d+)"', src)
    pages = _int(pm.group(1)) if pm else 0
    if not pages:
        found = [int(x) for x in re.findall(r"/page/(\d+)/", src)]
        pages = max(found) if found else 0

    cards: list[dict] = []
    seen: set[str] = set()
    for chunk in src.split('<div class="hg-drama-card"')[1:]:
        end = chunk.find('<div class="hg-drama-card"')
        block = chunk if end < 0 else chunk[:end]
        idm = re.search(r'data-track-id="(\d+)"', block) or re.search(r'href="/detail/(\d+)/"', block)
        if not idm:
            continue
        vid = idm.group(1)
        if vid in seen:
            continue
        seen.add(vid)
        tm = re.search(r'data-track-title="([^"]*)"', block) or re.search(r'alt="([^"]*)"', block)
        cm = re.search(r'data-src="([^"]+)"', block) or re.search(r'<img[^>]+src="([^"]+)"', block)
        sm = re.search(r'hg-drama-card__score"[^>]*>\s*([\d.]+)\s*分', block)
        em = re.search(r'data-ep-base="([^"]*)"', block)
        ep_label = _clean(em.group(1)) if em else ""
        tags = [_clean(t) for t in re.findall(r'class="hg-tag"[^>]*>([^<]*)</a>', block)]
        cards.append(
            {
                "id": vid,
                "title": _clean(tm.group(1)) if tm else "",
                "cover": _abs(cm.group(1), BASE_AI) if cm else "",
                "score": float(sm.group(1)) if sm else None,
                "episodeCount": _ep_number(ep_label),
                "episodeLabel": ep_label,
                "tags": [t for t in tags if t],
            }
        )
    return cards, pages, title


def map_ai_card(card: dict, locale: str = "zh") -> dict:
    """Tag-page cards expose fewer fields than the category JSON list."""
    return {
        "id": str(card.get("id") or ""),
        "title": card.get("title") or "",
        "cover": card.get("cover") or "",
        "description": "",
        "durationSec": 0,
        "episodeCount": _int(card.get("episodeCount")),
        "episodeLabel": card.get("episodeLabel") or "",
        "score": card.get("score"),
        "isFinished": False,
        "isOriginal": False,
        "tags": card.get("tags") or [],
        "actors": [],
        "hot": 0,
        "createdAt": "",
    }


def scrape_ai_tag(slug: str, page: int = 1, locale: str = "zh") -> dict:
    s = re.sub(r"[^a-z0-9_-]", "", str(slug or "").strip().lower())
    if not s:
        return {"ok": False, "error": "slug required"}
    p = max(1, _int(page, 1))
    # /tag/x/2/ 404s upstream; the paged form is /tag/x/page/2/.
    path = f"/tag/{quote(s)}/" if p == 1 else f"/tag/{quote(s)}/page/{p}/"
    html = _fetch(f"{BASE_AI}{path}", headers=AI_HEADERS, missing_on_404=True)
    if not html:
        return {"ok": False, "code": "NOT_FOUND", "error": f"tag {s} page {p} not found"}
    cards, pages, title = parse_ai_tag_page(html)
    if not cards and not pages:
        return {"ok": False, "error": "tag page had no cards"}
    max_page = pages or (p if len(cards) >= 20 else 0)
    return {
        "ok": True,
        "slug": s,
        "title": title or s,
        "page": p,
        "pageSize": AI_PAGE_SIZE,
        "maxPage": max_page or None,
        "hasMore": bool(max_page) and p < max_page,
        "items": [map_ai_card(c, locale) for c in cards],
        "source": "huangguo-ai",
    }


def map_tag(t: dict, is_hot: bool = False) -> dict:
    slug = str(t.get("slug") or "").strip()
    return {
        "slug": slug,
        "name": _clean(str(t.get("name") or slug)),
        "categoryName": _clean(str(t.get("cate_name") or "")),
        "hotScore": _int(t.get("hot_score")),
        "isHot": bool(t.get("is_hot")) or is_hot,
    }


def scrape_ai_tags(locale: str = "zh") -> dict:
    payload = _fetch_json(f"{BASE_AI}/api/tags", headers=AI_HEADERS)
    if _int(payload.get("status"), 1) != 1:
        return {"ok": False, "error": str(payload.get("msg") or "ai tags failed")}
    data = payload.get("data") or {}
    categories = []
    for cat in data.get("categories") or []:
        if not isinstance(cat, dict):
            continue
        tags = []
        for t in cat.get("tags") or []:
            if not isinstance(t, dict) or not str(t.get("slug") or "").strip():
                continue
            tag = map_tag(t)
            tag["categoryName"] = tag["categoryName"] or _clean(str(cat.get("name") or ""))
            tags.append(tag)
        if tags:
            categories.append({"name": _clean(str(cat.get("name") or "")), "tags": tags})
    hot = [
        map_tag(t, is_hot=True)
        for t in data.get("hot") or []
        if isinstance(t, dict) and str(t.get("slug") or "").strip()
    ]
    return {"ok": True, "categories": categories, "hot": hot, "source": "huangguo-ai"}


def parse_video_cards(html: str) -> tuple[list[dict], int]:
    src = html or ""
    pages = [int(x) for x in re.findall(r"/videos\?category=[^\"&]*&(?:amp;)?page=(\d+)", src)]
    max_page = max(pages) if pages else 0
    items: list[dict] = []
    seen: set[str] = set()
    for chunk in src.split('<article class="video-card')[1:]:
        hm = re.search(r'href="/(series|video)/([a-z0-9]+)"', chunk)
        if not hm:
            continue
        kind, code = hm.group(1), hm.group(2)
        if code in seen:
            continue
        seen.add(code)
        tm = re.search(r'alt="([^"]*)"', chunk)
        cm = re.search(r'class="video-cover-img[^"]*"[^>]*src="([^"]+)"', chunk) or re.search(
            r'<img[^>]+src="(/uploads/[^"]+)"', chunk
        )
        ep_m = re.search(r'bg-black/55[^"]*">\s*([^<]*?)\s*<', chunk)
        meta_m = re.search(r'text-cream/70 font-mono-meta">(.*?)</p>', chunk, re.S)
        items.append(
            {
                "id": f"{'s' if kind == 'series' else 'v'}:{code}",
                "kind": kind,
                "code": code,
                "title": _clean(tm.group(1)) if tm else "",
                "cover": _abs(cm.group(1), BASE_VIDEO) if cm else "",
                "episodeLabel": _clean(ep_m.group(1)) if ep_m else "",
                "tags": _video_tag_chips(chunk),
                "meta": _clean(re.sub(r"<[^>]+>", " ", meta_m.group(1))) if meta_m else "",
            }
        )
    return items, max_page


def _video_tag_chips(chunk: str) -> list[str]:
    """Genre chips are text-gold-dim spans; the author link reuses that colour."""
    chips: list[str] = []
    for m in re.finditer(r"<(a|span)([^>]*)>([^<]*)</\1>", chunk or ""):
        attrs, text = m.group(2), _clean(m.group(3))
        if "text-gold-dim" not in attrs or not text:
            continue
        if "/user/" in attrs or text.startswith("@"):
            continue
        chips.append(text)
    return chips


def map_video_card(card: dict, locale: str = "zh") -> dict:
    ep_label = card.get("episodeLabel") or ""
    meta = card.get("meta") or ""
    return {
        "id": card.get("id") or "",
        "title": card.get("title") or "",
        "cover": card.get("cover") or "",
        "description": meta,
        "durationSec": 0,
        "episodeCount": _ep_number(ep_label),
        "episodeLabel": ep_label,
        "score": None,
        "isFinished": "已完结" in ep_label or "已完结" in meta,
        "isOriginal": False,
        "tags": card.get("tags") or [],
        "actors": [],
        "kind": card.get("kind") or "video",
        "hot": 0,
        "createdAt": "",
    }


def scrape_video_list(category: str = "all", page: int = 1, locale: str = "zh") -> dict:
    cat = video_category(category)
    if not cat:
        return {"ok": False, "error": f"unknown video category: {category}"}
    p = max(1, _int(page, 1))
    html = _fetch(f"{BASE_VIDEO}/videos?category={quote(cat['slug'])}&page={p}", headers=VIDEO_HEADERS)
    cards, max_page = parse_video_cards(html)
    return {
        "ok": True,
        "category": cat["slug"],
        "title": _title_of(cat, locale),
        "page": p,
        "pageSize": VIDEO_PAGE_SIZE,
        "maxPage": max_page or None,
        "hasMore": bool(max_page) and p < max_page,
        "items": [map_video_card(c, locale) for c in cards],
        "source": "huangguo-video",
    }


def parse_series_page(html: str) -> dict:
    src = html or ""
    title = ""
    m = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S)
    if m:
        title = _clean(re.sub(r"<[^>]+>", "", m.group(1)))
    cover = ""
    cm = re.search(r'<img[^>]+src="(/uploads/[^"]+)"', src)
    if cm:
        cover = _abs(cm.group(1), BASE_VIDEO)
    author = ""
    meta_line = ""
    mm = re.search(r'class="mt-2 text-sm text-mist-dim font-mono-meta">(.*?)</p>', src, re.S)
    if mm:
        inner = mm.group(1)
        meta_line = _clean(re.sub(r"<[^>]+>", " ", inner))
        am = re.search(r"@([^<\s]+)", inner)
        if am:
            author = _clean(am.group(1))
    tags = [
        _clean(t)
        for t in re.findall(
            r'href="/videos\?category=[^"]*&(?:amp;)?tags=\d+"[^>]*>([^<]*)</a>', src
        )
        if _clean(t)
    ]

    episodes: list[dict] = []
    seen: set[str] = set()
    for chunk in src.split('<a href="/video/')[1:]:
        code_m = re.match(r"([a-z0-9]+)\"", chunk)
        if not code_m:
            continue
        code = code_m.group(1)
        if code in seen:
            continue
        head = chunk[:1200]
        # Episode tiles nest a series-ep-thumb block; nav and hero links do not.
        if "series-ep-thumb" not in head:
            continue
        seen.add(code)
        em = re.search(r'alt="([^"]*)"', head) or re.search(r'line-clamp-2">([^<]*)<', head)
        dm = re.search(r"bg-black/50[^>]*>\s*([\d:]+)\s*<", head)
        episodes.append(
            {
                "code": code,
                "title": _clean(em.group(1)) if em else "",
                "ep": 0,
                "durationSec": _duration_sec(dm.group(1)) if dm else 0,
            }
        )
    episodes.sort(key=lambda e: _ep_number(e["title"]) or 0)
    for i, e in enumerate(episodes, start=1):
        e["ep"] = _ep_number(e["title"]) or i
    return {
        "title": title,
        "cover": cover,
        "author": author,
        "meta": meta_line,
        "tags": tags,
        "episodeCount": _ep_number(meta_line) or len(episodes),
        "episodes": episodes,
    }


def parse_video_page(html: str) -> dict:
    src = html or ""
    hls = ""
    hm = re.search(r'data-hls="([^"]+)"', src)
    if hm:
        hls = _abs(hm.group(1), BASE_VIDEO)
    title = ""
    tm = re.search(r"<h1[^>]*>(.*?)</h1>", src, re.S)
    if tm:
        title = _clean(re.sub(r"<[^>]+>", "", tm.group(1)))
    cover = ""
    cm = re.search(r'data-poster="([^"]+)"', src)
    if cm:
        cover = _abs(cm.group(1), BASE_VIDEO)
    category_name = ""
    bm = re.search(r'href="/videos\?category=[^"]*"[^>]*>([^<]*)</a>', src)
    if bm:
        category_name = _clean(bm.group(1))
    return {
        "title": title,
        "stream": {"masterUrl": hls} if hls else None,
        "cover": cover,
        "categoryName": category_name,
        "tags": [
            _clean(t)
            for t in re.findall(
                r'href="/videos\?category=[^"]*&(?:amp;)?tags=\d+"[^>]*>([^<]*)</a>', src
            )
            if _clean(t)
        ],
    }


def scrape_video_detail(video_id: str, locale: str = "zh") -> dict:
    raw_id = str(video_id or "").strip()
    if not raw_id:
        return {"ok": False, "error": "id required"}
    if raw_id.startswith("s:"):
        kind, code = "series", raw_id[2:]
    elif raw_id.startswith("v:"):
        kind, code = "video", raw_id[2:]
    else:
        kind, code = "video", raw_id
    if not re.fullmatch(r"[A-Za-z0-9_-]+", code or ""):
        return {"ok": False, "error": "bad id"}
    html = _fetch(
        f"{BASE_VIDEO}/{'series' if kind == 'series' else 'video'}/{quote(code)}",
        headers=VIDEO_HEADERS,
        missing_on_404=True,
    )
    if not html:
        return {"ok": False, "code": "NOT_FOUND", "error": "not found"}
    if kind == "series":
        parsed = parse_series_page(html)
        episodes = [
            {
                "ep": e["ep"],
                "title": e["title"] or f"第{e['ep']}集",
                "durationSec": e["durationSec"],
                "playable": True,
                "code": e["code"],
            }
            for e in parsed["episodes"]
        ]
        if not episodes:
            return {"ok": False, "error": "series had no episodes"}
        item = {
            "id": f"s:{code}",
            "kind": "series",
            "title": parsed["title"],
            "cover": parsed["cover"],
            "description": parsed["meta"],
            "tags": parsed["tags"],
            "actors": [parsed["author"]] if parsed["author"] else [],
            "episodeCount": len(episodes),
            "episodes": episodes,
        }
    else:
        parsed = parse_video_page(html)
        item = {
            "id": f"v:{code}",
            "kind": "video",
            "title": parsed["title"],
            "cover": parsed["cover"],
            "description": parsed["categoryName"],
            "tags": parsed["tags"],
            "actors": [],
            "categoryName": parsed["categoryName"],
            "episodeCount": 1,
            "episodes": [
                {
                    "ep": 1,
                    "title": parsed["title"] or "第1集",
                    "durationSec": 0,
                    "playable": True,
                    "code": code,
                }
            ],
            "stream": parsed["stream"],
        }
    return {"ok": True, "item": item, "source": "huangguo-video"}


def scrape_video_stream(code: str, locale: str = "zh") -> dict:
    c = re.sub(r"^(s|v):", "", str(code or "").strip())
    if not re.fullmatch(r"[A-Za-z0-9_-]+", c or ""):
        return {"ok": False, "error": "bad code"}
    html = _fetch(f"{BASE_VIDEO}/video/{quote(c)}", headers=VIDEO_HEADERS, missing_on_404=True)
    if not html:
        return {"ok": False, "code": "NOT_FOUND", "error": "not found"}
    parsed = parse_video_page(html)
    stream = parsed["stream"]
    out = {
        "ok": bool(stream),
        "code": c,
        "title": parsed["title"],
        "coverUrl": parsed["cover"],
        "stream": stream,
        "source": "huangguo-video",
    }
    if not stream:
        out["error"] = "no playable source"
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: scrape_huangguo.py <mode> ..."}, ensure_ascii=False))
        return 2
    mode = argv[1].lower()
    arg = lambda i, default="": argv[i] if len(argv) > i and argv[i] not in {"-", ""} else default
    try:
        if mode == "ai-list":
            data = scrape_ai_list(arg(2), arg(3, "hot"), _int(arg(4, "1"), 1), arg(5, "zh"))
        elif mode == "ai-detail":
            data = scrape_ai_detail(arg(2))
        elif mode == "ai-tags":
            data = scrape_ai_tags(arg(2, "zh"))
        elif mode == "ai-tag":
            data = scrape_ai_tag(arg(2), _int(arg(3, "1"), 1))
        elif mode == "ai-ep":
            data = scrape_ai_episode(arg(2), _int(arg(3, "1"), 1))
        elif mode == "video-list":
            data = scrape_video_list(arg(2, "all"), _int(arg(3, "1"), 1))
        elif mode == "video-detail":
            data = scrape_video_detail(arg(2))
        elif mode == "video-stream":
            data = scrape_video_stream(arg(2))
        else:
            data = {"ok": False, "error": f"unknown mode {mode}"}
    except Exception as e:  # noqa: BLE001 - CLI boundary
        data = {"ok": False, "error": str(e)}
    print(json.dumps(data, ensure_ascii=False))
    return 0 if data.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
