#!/usr/bin/env python3
"""Scrape whos.tv frames / topics / ranking into JSON.

whos.tv is an image-search + frame-tag site (not a MissAV catalog mirror).
Public surfaces are mostly HTML; list pagination uses:
  GET /ajax/frames?type_id=&label_id=&page=
  GET /frames[/type-X[/label-N]][/page-N]
  GET /topics[/category/X][/page-N]
  GET /topics/details/{id}
  GET /ranking/video | /ranking/actress
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

BASE = "https://whos.tv"
DEFAULT_HEADERS = {
    "Referer": f"{BASE}/",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# type_id → slug used in /frames/type-{slug}
FRAME_TYPES: list[dict[str, Any]] = [
    {"typeId": 1, "type": "clothes", "titleZh": "服装", "titleEn": "Clothes"},
    {"typeId": 2, "type": "location", "titleZh": "地点", "titleEn": "Location"},
    {"typeId": 3, "type": "closeup", "titleZh": "特写", "titleEn": "Close-up"},
    {"typeId": 4, "type": "pose", "titleZh": "姿势", "titleEn": "Pose"},
    {"typeId": 5, "type": "action", "titleZh": "行为", "titleEn": "Action"},
    {"typeId": 6, "type": "expression", "titleZh": "表情", "titleEn": "Expression"},
    {"typeId": 7, "type": "prop", "titleZh": "道具", "titleEn": "Prop"},
    {"typeId": 8, "type": "other", "titleZh": "其他", "titleEn": "Other"},
]
TYPE_BY_ID = {t["typeId"]: t for t in FRAME_TYPES}
TYPE_BY_SLUG = {t["type"]: t for t in FRAME_TYPES}

TOPIC_CATEGORIES: list[dict[str, str]] = [
    {"id": "", "slug": "", "titleZh": "全部", "titleEn": "All"},
    {
        "id": "personal-topic",
        "slug": "personal-topic",
        "titleZh": "个人精选",
        "titleEn": "Personal",
    },
    {
        "id": "uncensored-topic",
        "slug": "uncensored-topic",
        "titleZh": "无码专题",
        "titleEn": "Uncensored",
    },
    {
        "id": "clothes-topic",
        "slug": "clothes-topic",
        "titleZh": "服装专题",
        "titleEn": "Clothes",
    },
    {
        "id": "scene-topic",
        "slug": "scene-topic",
        "titleZh": "场景专题",
        "titleEn": "Scene",
    },
    {
        "id": "story-topic",
        "slug": "story-topic",
        "titleZh": "情节专题",
        "titleEn": "Story",
    },
]

_session = None


def _sess():
    global _session
    if _session is None:
        _session = requests.Session()
    return _session


def _clean(s: str) -> str:
    return html_lib.unescape(re.sub(r"\s+", " ", (s or "")).strip())


def _normalize_locale(locale: str) -> str:
    loc = (locale or "zh").lower()
    if loc.startswith("en"):
        return "en"
    if loc.startswith("ja"):
        return "ja"
    if "tw" in loc or "hant" in loc:
        return "zh-tw"
    return "zh"


def _locale_prefix(locale: str) -> str:
    loc = _normalize_locale(locale)
    if loc == "zh":
        return ""
    return f"/{loc}"


def _fetch(url: str, *, referer: str | None = None, timeout: int = 35) -> str:
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers["Referer"] = referer
    last_err = "request failed"
    # Match scrape_list fingerprint rotation for CF soft-blocks.
    for impersonate in ("chrome124", "chrome131", "safari17_0"):
        try:
            kwargs: dict = {
                "headers": headers,
                "timeout": timeout,
                "impersonate": impersonate,
                "allow_redirects": True,
            }
            if CURL_OPTS:
                kwargs["curl_options"] = CURL_OPTS
            r = _sess().get(url, **kwargs)
        except TypeError:
            # Older curl_cffi without curl_options support
            try:
                r = _sess().get(
                    url,
                    headers=headers,
                    timeout=timeout,
                    impersonate=impersonate,
                    allow_redirects=True,
                )
            except Exception as e:
                last_err = str(e)
                continue
        except Exception as e:
            last_err = str(e)
            continue
        if r.status_code in {403, 503, 429, 520, 521, 522, 523, 524}:
            last_err = f"HTTP {r.status_code}"
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code} for {url}")
        text = r.text or ""
        if len(text) < 400 and "just a moment" in text.lower():
            last_err = "cloudflare challenge"
            continue
        return text
    raise RuntimeError(f"{last_err} for {url}")


def _abs_url(path_or_url: str) -> str:
    if not path_or_url:
        return ""
    if path_or_url.startswith("http"):
        return path_or_url
    return urljoin(BASE + "/", path_or_url.lstrip("/"))


def _parse_code_from_title(title: str) -> str:
    m = re.match(r"([A-Za-z0-9][A-Za-z0-9\-_.]+)", title or "")
    return (m.group(1) if m else "").lower()


def _parse_timestamp(title: str) -> str:
    m = re.search(r"(\d{1,2}:\d{2}:\d{2})", title or "")
    return m.group(1) if m else ""


def _parse_actress(title: str) -> str:
    m = re.search(r"(?:女优|Actress)\[([^\]]+)\]", title or "", re.I)
    return _clean(m.group(1)) if m else ""


def parse_frame_cards(html: str) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'<a[^>]*href="(/frames/(\d+))"[^>]*class="[^"]*frame-card[^"]*"[^>]*>(.*?)</a>',
        html or "",
        re.I | re.S,
    ):
        fid = m.group(2)
        if fid in seen:
            continue
        block = m.group(0)
        title_m = re.search(r'data-frame-title="([^"]*)"', block, re.I)
        title = _clean(title_m.group(1) if title_m else "")
        if not title:
            alt_m = re.search(r'alt="([^"]+)"', block, re.I)
            title = _clean(alt_m.group(1) if alt_m else "")
        img_m = re.search(
            r'(?:src|data-src)="(https?://[^"]+)"',
            block,
            re.I,
        )
        img = img_m.group(1) if img_m else ""
        # Prefer non-skeleton full images
        if not img:
            lazy = re.search(r'data-src="(https?://[^"]+)"', block, re.I)
            img = lazy.group(1) if lazy else ""
        code = _parse_code_from_title(title)
        items.append(
            {
                "id": fid,
                "title": title,
                "imageUrl": img,
                "code": code,
                "timestamp": _parse_timestamp(title),
                "actress": _parse_actress(title),
                "path": m.group(1),
            }
        )
        seen.add(fid)
    # Fallback: looser card match without class requirement
    if not items:
        for m in re.finditer(
            r'<a[^>]*href="(/frames/(\d+))"[^>]*>(.*?)</a>',
            html or "",
            re.I | re.S,
        ):
            fid = m.group(2)
            if fid in seen:
                continue
            block = m.group(0)
            if "data-frame-id" not in block and "frame" not in block.lower():
                continue
            title_m = re.search(r'data-frame-title="([^"]*)"', block, re.I)
            title = _clean(title_m.group(1) if title_m else "")
            img_m = re.search(r'(?:src|data-src)="(https?://[^"]+)"', block, re.I)
            img = img_m.group(1) if img_m else ""
            if not title and not img:
                continue
            items.append(
                {
                    "id": fid,
                    "title": title,
                    "imageUrl": img,
                    "code": _parse_code_from_title(title),
                    "timestamp": _parse_timestamp(title),
                    "actress": _parse_actress(title),
                    "path": m.group(1),
                }
            )
            seen.add(fid)
    return items


def parse_labels_from_home(html: str) -> list[dict]:
    out: list[dict] = []
    for m in re.finditer(
        r'data-parent-category-id="(\d+)"([\s\S]*?)(?=data-parent-category-id="|id="frame-cards"|$)',
        html or "",
    ):
        parent = int(m.group(1))
        ptype = TYPE_BY_ID.get(parent, {}).get("type", "")
        for sm in re.finditer(
            r'data-sub-category="(\d+)"[^>]*>\s*([^<]+)',
            m.group(2),
        ):
            lid = sm.group(1)
            if not lid:
                continue
            out.append(
                {
                    "typeId": parent,
                    "type": ptype,
                    "labelId": int(lid),
                    "name": _clean(sm.group(2)),
                }
            )
    return out


def _max_page(html: str, path_prefix: str) -> int | None:
    """Best-effort max page from pagination links."""
    pages: list[int] = []
    # /frames/page-N  or /frames/type-x/page-N  or /topics/page-N
    pat = re.escape(path_prefix.rstrip("/")) + r"/page-(\d+)"
    for m in re.finditer(pat, html or "", re.I):
        try:
            pages.append(int(m.group(1)))
        except ValueError:
            pass
    # generic page-N near end
    if not pages:
        for m in re.finditer(r"/page-(\d+)", html or ""):
            try:
                pages.append(int(m.group(1)))
            except ValueError:
                pass
    if not pages:
        return None
    return max(pages)


def scrape_frame_categories(locale: str = "zh") -> dict:
    prefix = _locale_prefix(locale)
    url = f"{BASE}{prefix}/" if prefix else f"{BASE}/"
    try:
        html = _fetch(url)
    except Exception as e:
        return {"ok": False, "error": str(e), "types": FRAME_TYPES, "labels": []}
    labels = parse_labels_from_home(html)
    types = []
    for t in FRAME_TYPES:
        types.append(
            {
                **t,
                "title": t["titleEn"] if _normalize_locale(locale) == "en" else t["titleZh"],
            }
        )
    return {
        "ok": True,
        "source": "whos",
        "types": types,
        "labels": labels,
        "url": url,
    }


def _resolve_type(type_slug: str | None, type_id: int | None) -> dict | None:
    if type_id and type_id in TYPE_BY_ID:
        return TYPE_BY_ID[type_id]
    if type_slug:
        slug = str(type_slug).strip().lower()
        if slug in TYPE_BY_SLUG:
            return TYPE_BY_SLUG[slug]
        # allow numeric string
        if slug.isdigit() and int(slug) in TYPE_BY_ID:
            return TYPE_BY_ID[int(slug)]
    return None


def scrape_frames(
    *,
    type_slug: str = "",
    type_id: int | None = None,
    label_id: int | None = None,
    page: int = 1,
    locale: str = "zh",
) -> dict:
    page = max(1, int(page or 1))
    label_id = int(label_id) if label_id else None
    tinfo = _resolve_type(type_slug, type_id)
    prefix = _locale_prefix(locale)

    # Prefer ajax for typed lists (stable HTML fragment).
    if tinfo:
        tid = tinfo["typeId"]
        ajax_url = (
            f"{BASE}/ajax/frames?type_id={tid}"
            f"&label_id={label_id or ''}&page={page}"
        )
        try:
            frag = _fetch(
                ajax_url,
                referer=f"{BASE}{prefix}/frames/type-{tinfo['type']}",
            )
            items = parse_frame_cards(frag)
            # ajax fragment may omit outer <a class=frame-card> structure sometimes —
            # also try bare data-frame-id cards
            if not items:
                items = parse_frame_cards(
                    re.sub(
                        r"(<a[^>]*href=\"/frames/\d+\")",
                        r'\1 class="frame-card"',
                        frag,
                    )
                )
            has_more = len(items) >= 8
            return {
                "ok": True,
                "source": "whos-ajax",
                "page": page,
                "hasMore": has_more,
                "type": tinfo["type"],
                "typeId": tid,
                "labelId": label_id,
                "title": (
                    tinfo["titleEn"]
                    if _normalize_locale(locale) == "en"
                    else tinfo["titleZh"]
                ),
                "items": items,
                "url": ajax_url,
            }
        except Exception:
            # fall through to full page
            pass

        path = f"/frames/type-{tinfo['type']}"
        if label_id:
            path += f"/label-{label_id}"
        if page > 1:
            path += f"/page-{page}"
    else:
        path = "/frames"
        if page > 1:
            path += f"/page-{page}"

    url = f"{BASE}{prefix}{path}"
    try:
        html = _fetch(url)
    except Exception as e:
        return {"ok": False, "error": str(e), "items": [], "page": page}

    items = parse_frame_cards(html)
    max_page = _max_page(html, path.split("/page-")[0] if "/page-" in path else path)
    has_more = (max_page is not None and page < max_page) or len(items) >= 12
    title = "Frame Explore" if _normalize_locale(locale) == "en" else "帧探索"
    if tinfo:
        title = (
            tinfo["titleEn"] if _normalize_locale(locale) == "en" else tinfo["titleZh"]
        )
    return {
        "ok": True,
        "source": "whos",
        "page": page,
        "maxPage": max_page,
        "hasMore": has_more,
        "type": tinfo["type"] if tinfo else "",
        "typeId": tinfo["typeId"] if tinfo else None,
        "labelId": label_id,
        "title": title,
        "items": items,
        "url": url,
    }


def scrape_frame_detail(frame_id: str, locale: str = "zh") -> dict:
    fid = re.sub(r"[^\d]", "", str(frame_id or ""))
    if not fid:
        return {"ok": False, "error": "frame id required"}
    prefix = _locale_prefix(locale)
    url = f"{BASE}{prefix}/frames/{fid}"
    try:
        html = _fetch(url)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    # Primary image: first f.imgcaches frame image
    imgs = re.findall(
        r'src="(https?://f\.imgcaches\.cc/video_frames/[^"]+)"',
        html,
        re.I,
    )
    image_url = imgs[0] if imgs else ""

    video_m = re.search(r'href="(/videos/([^"?]+)(?:\?t=(\d+))?)"', html, re.I)
    code = (video_m.group(2) if video_m else "").lower()
    seek_sec = int(video_m.group(3)) if video_m and video_m.group(3) else None

    title = ""
    # share / data-frame-title for main id
    tm = re.search(
        rf'data-frame-id="{re.escape(fid)}"[^>]*data-frame-title="([^"]*)"',
        html,
        re.I,
    )
    if tm:
        title = _clean(tm.group(1))
    if not title:
        tm2 = re.search(r'data-share-title="([^"]+)"', html, re.I)
        title = _clean(tm2.group(1) if tm2 else "")
    if not title and code:
        title = code

    if not code:
        code = _parse_code_from_title(title)

    label_m = re.search(r'data-frame-label="([^"]+)"', html, re.I)
    label = _clean(label_m.group(1) if label_m else "")
    timestamp = _parse_timestamp(title) or _parse_timestamp(label)
    actress = _parse_actress(title)

    # tags from alt texts like "卧室 · 白色内衣 · …"
    tags: list[str] = []
    for alt in re.findall(r'<img[^>]*alt="([^"]+·[^"]+)"', html):
        parts = [_clean(p) for p in alt.split("·")]
        for p in parts:
            if p and p not in tags and len(p) < 40:
                tags.append(p)

    related = [it for it in parse_frame_cards(html) if it["id"] != fid]

    return {
        "ok": True,
        "source": "whos",
        "item": {
            "id": fid,
            "title": title,
            "imageUrl": image_url,
            "code": code,
            "timestamp": timestamp,
            "actress": actress,
            "seekSec": seek_sec,
            "label": label,
            "tags": tags,
            "path": f"/frames/{fid}",
            "videoPath": video_m.group(1).split("?")[0] if video_m else (
                f"/videos/{code}" if code else ""
            ),
        },
        "related": related[:24],
        "url": url,
    }


def parse_topic_cards(html: str) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'<a href="/topics/details/(\d+)"[^>]*class="[^"]*group[^"]*"[^>]*>([\s\S]*?)</a>',
        html or "",
        re.I,
    ):
        tid = m.group(1)
        if tid in seen:
            continue
        block = m.group(0)
        seen.add(tid)
        img_m = re.search(
            r'<img[^>]*alt="([^"]*)"[^>]*src="(https?://[^"]+)"|<img[^>]*src="(https?://[^"]+)"[^>]*alt="([^"]*)"',
            block,
            re.I,
        )
        title = ""
        cover = ""
        if img_m:
            if img_m.group(2):
                title = _clean(img_m.group(1) or "")
                cover = img_m.group(2)
            else:
                cover = img_m.group(3) or ""
                title = _clean(img_m.group(4) or "")
        desc = ""
        texts = [_clean(t) for t in re.findall(r">([^<]{2,100})<", block)]
        texts = [t for t in texts if t and t not in {title}]
        # description often second meaningful text
        for t in texts:
            if re.search(r"\d+\s*(帧|影片|frames?|videos?)", t, re.I):
                continue
            if t.isdigit():
                continue
            if not desc and t != title:
                desc = t
                break
        frame_count = None
        video_count = None
        fav_count = None
        for t in texts:
            fm = re.search(r"([\d,]+)\s*帧", t)
            if fm:
                frame_count = int(fm.group(1).replace(",", ""))
            vm = re.search(r"([\d,]+)\s*影片", t)
            if vm:
                video_count = int(vm.group(1).replace(",", ""))
            if t.isdigit() and fav_count is None and len(t) <= 6:
                # last pure number often favorites; take largest later
                try:
                    fav_count = int(t)
                except ValueError:
                    pass
        if not title:
            title = f"Topic {tid}"
        items.append(
            {
                "id": tid,
                "title": title,
                "description": desc,
                "coverUrl": cover,
                "frameCount": frame_count,
                "videoCount": video_count,
                "favoriteCount": fav_count,
                "path": f"/topics/details/{tid}",
            }
        )
    return items


def scrape_topics(
    *,
    category: str = "",
    page: int = 1,
    locale: str = "zh",
) -> dict:
    page = max(1, int(page or 1))
    cat = str(category or "").strip().lower()
    if cat in {"all", "全部"}:
        cat = ""
    prefix = _locale_prefix(locale)
    if cat:
        path = f"/topics/category/{quote(cat)}"
    else:
        path = "/topics"
    if page > 1:
        path += f"/page-{page}"
    url = f"{BASE}{prefix}{path}"
    try:
        html = _fetch(url)
    except Exception as e:
        return {"ok": False, "error": str(e), "items": [], "page": page}

    items = parse_topic_cards(html)
    max_page = _max_page(html, path.split("/page-")[0] if "/page-" in path else path)
    has_more = (max_page is not None and page < max_page) or len(items) >= 12
    cats = []
    for c in TOPIC_CATEGORIES:
        cats.append(
            {
                **c,
                "title": c["titleEn"]
                if _normalize_locale(locale) == "en"
                else c["titleZh"],
            }
        )
    title = "Topics" if _normalize_locale(locale) == "en" else "专题合集"
    return {
        "ok": True,
        "source": "whos",
        "page": page,
        "maxPage": max_page,
        "hasMore": has_more,
        "category": cat,
        "categories": cats,
        "title": title,
        "items": items,
        "url": url,
    }


def scrape_topic_detail(topic_id: str, page: int = 1, locale: str = "zh") -> dict:
    tid = re.sub(r"[^\d]", "", str(topic_id or ""))
    if not tid:
        return {"ok": False, "error": "topic id required"}
    page = max(1, int(page or 1))
    prefix = _locale_prefix(locale)
    path = f"/topics/details/{tid}"
    if page > 1:
        path += f"/page-{page}"
    url = f"{BASE}{prefix}{path}"
    try:
        html = _fetch(url)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    title = ""
    hm = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.I)
    if hm:
        title = _clean(re.sub(r"<[^>]+>", "", hm.group(1)))
    if not title:
        tm = re.search(r'id="topic-title"[^>]*>([^<]+)<', html, re.I)
        title = _clean(tm.group(1) if tm else "") or f"Topic {tid}"

    description = ""
    # first meaningful muted paragraph after h1
    for m in re.finditer(
        r"text-muted-foreground[^>]*>([^<]{4,200})<",
        html,
    ):
        t = _clean(m.group(1))
        if not t or t.startswith("©") or "Whos.tv" in t:
            continue
        if re.match(r"^[\d·\s]+$", t):
            continue
        if "发布" in t or "published" in t.lower():
            continue
        description = t
        break

    cover = ""
    cm = re.search(
        r'<img[^>]*src="(https?://(?:f|v)\.imgcaches\.cc/[^"]+)"',
        html,
        re.I,
    )
    if cm:
        cover = cm.group(1)

    frames = parse_frame_cards(html)
    frame_count = None
    fcm = re.search(r">\s*([\d,]+)\s*<[\s\S]{0,40}?帧", html)
    if fcm:
        try:
            frame_count = int(fcm.group(1).replace(",", ""))
        except ValueError:
            pass

    max_page = _max_page(html, f"/topics/details/{tid}")
    has_more = (max_page is not None and page < max_page) or len(frames) >= 16

    return {
        "ok": True,
        "source": "whos",
        "page": page,
        "maxPage": max_page,
        "hasMore": has_more,
        "item": {
            "id": tid,
            "title": title,
            "description": description,
            "coverUrl": cover,
            "frameCount": frame_count,
            "path": f"/topics/details/{tid}",
        },
        "frames": frames,
        "url": url,
    }


def _parse_hot_frames(card_html: str) -> list[dict]:
    """Parse 热门帧 thumbs from a ranking video card (right-side carousel)."""
    frames: list[dict] = []
    seen: set[str] = set()
    # Prefer the data-frames carousel block when present.
    block_m = re.search(
        r'data-frames[^>]*>([\s\S]*?)(?:data-btn-right|</div>\s*</div>\s*</div>\s*</div>)',
        card_html or "",
        re.I,
    )
    scope = block_m.group(1) if block_m else (card_html or "")
    for m in re.finditer(
        r'<a[^>]*href="/frames/(\d+)"[^>]*>([\s\S]*?)</a>',
        scope,
        re.I,
    ):
        fid = m.group(1)
        if fid in seen:
            continue
        inner = m.group(2)
        img_m = re.search(
            r'(?:src|data-src)="(https?://[^"]+\.(?:webp|jpg|jpeg|png)[^"]*)"',
            inner,
            re.I,
        )
        if not img_m:
            img_m = re.search(
                r'(?:src|data-src)="(https?://f\.imgcaches\.cc/[^"]+)"',
                inner,
                re.I,
            )
        alt_m = re.search(r'alt="([^"]*)"', inner, re.I)
        frames.append(
            {
                "id": fid,
                "imageUrl": img_m.group(1) if img_m else "",
                "title": _clean(alt_m.group(1) if alt_m else ""),
                "path": f"/frames/{fid}",
            }
        )
        seen.add(fid)
        if len(frames) >= 12:
            break
    return frames


def parse_ranking_videos(html: str) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    # Split on ranking card shells (full card so 热门帧 carousel is included).
    parts = re.split(
        r'(?=class="rounded-xl overflow-hidden border transition-all)',
        html or "",
    )
    for body in parts:
        if 'href="/videos/' not in body:
            continue
        vm = re.search(r'href="/videos/([^"#?]+)"', body, re.I)
        if not vm:
            continue
        code = vm.group(1).lower()
        if code in seen:
            continue
        # Rank badge near top of card
        rank_m = re.search(r'tabular-nums">(\d+)</span>', body[:2000])
        rank = int(rank_m.group(1)) if rank_m else len(items) + 1
        title_m = re.search(
            r'line-clamp-2[^"]*"[^>]*>\s*([^<]+?)\s*<',
            body,
        )
        if title_m:
            title = _clean(title_m.group(1))
        else:
            cands = [
                _clean(c)
                for c in re.findall(r">([^<]{6,120})<", body)
                if re.search(r"[\u4e00-\u9fffA-Za-z]", c)
                and not re.match(r"^[A-Z0-9\-]{3,30}$", c.strip())
            ]
            cands = [
                c
                for c in cands
                if c.lower() != code
                and "lucide" not in c
                and c not in {"热门帧", "Hot frames"}
                and not c.startswith("http")
            ]
            title = cands[0] if cands else code
        rating_m = re.search(
            r'text-amber-400 tabular-nums">([0-9.]+)</span>',
            body,
        )
        rating = float(rating_m.group(1)) if rating_m else None
        actresses = []
        for am in re.finditer(
            r'href="/actresses/([^"]+)"[^>]*>\s*([^<]+)',
            body,
        ):
            actresses.append(
                {"slug": am.group(1), "name": _clean(am.group(2))}
            )
        hot_frames = _parse_hot_frames(body)
        frame_ids = [f["id"] for f in hot_frames]
        frame_imgs = [f["imageUrl"] for f in hot_frames if f.get("imageUrl")]
        items.append(
            {
                "rank": rank,
                "id": code,
                "code": code,
                "title": title,
                "rating": rating,
                "actresses": [a["name"] for a in actresses],
                "actressSlugs": [a["slug"] for a in actresses],
                "hotFrames": hot_frames,
                "frameImageUrls": frame_imgs,
                "frameIds": frame_ids,
                # fourhoi cover filled by Node map
                "coverUrl": "",
            }
        )
        seen.add(code)
        if len(items) >= 100:
            break
    return items


def parse_ranking_actresses(html: str) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'href="(/actresses/([^"#?]+))"[^>]*>([\s\S]{0,1200}?)</a>',
        html or "",
        re.I,
    ):
        slug = m.group(2)
        if slug in seen or slug in {"", "ranking"}:
            continue
        block = m.group(0)
        name = _clean(
            re.sub(
                r"<[^>]+>",
                "",
                re.search(r">([^<]{1,40})</", block + "</").group(1)
                if re.search(r">([^<]{1,40})</", block + "</")
                else slug,
            )
        )
        # better: last text node
        texts = [_clean(t) for t in re.findall(r">([^<]+)<", block)]
        texts = [t for t in texts if t and not t.isdigit()]
        if texts:
            name = texts[-1] if len(texts[-1]) < 40 else texts[0]
        img_m = re.search(
            r'(?:src|data-src)="(https?://[^"]+actress[^"]+)"',
            block,
            re.I,
        )
        if not img_m:
            img_m = re.search(
                r'(?:src|data-src)="(https?://v\.imgcaches\.cc/[^"]+)"',
                block,
                re.I,
            )
        avatar = img_m.group(1) if img_m else ""
        if not avatar and "actress" not in block.lower() and not img_m:
            # skip pure nav links without avatar context
            if "avatar" not in block and "rounded-full" not in block:
                continue
        items.append(
            {
                "rank": len(items) + 1,
                "slug": slug,
                "name": name or slug,
                "avatarUrl": avatar,
                "path": m.group(1),
            }
        )
        seen.add(slug)
        if len(items) >= 100:
            break
    return items


def scrape_ranking(kind: str = "video", locale: str = "zh") -> dict:
    k = str(kind or "video").lower()
    if k not in {"video", "actress", "actresses"}:
        k = "video"
    if k == "actresses":
        k = "actress"
    prefix = _locale_prefix(locale)
    path = f"/ranking/{k}"
    url = f"{BASE}{prefix}{path}"
    try:
        html = _fetch(url)
    except Exception as e:
        return {"ok": False, "error": str(e), "items": [], "kind": k}

    if k == "actress":
        items = parse_ranking_actresses(html)
        title = (
            "Actress Ranking"
            if _normalize_locale(locale) == "en"
            else "女优排行榜"
        )
    else:
        items = parse_ranking_videos(html)
        title = (
            "Video Ranking" if _normalize_locale(locale) == "en" else "影片排行榜"
        )

    return {
        "ok": True,
        "source": "whos",
        "kind": k,
        "title": title,
        "items": items,
        "url": url,
    }


def main(argv: list[str]) -> int:
    """
    CLI:
      categories [locale]
      frames [type|-] [labelId|-] [page] [locale]
      frame <id> [locale]
      topics [category|-] [page] [locale]
      topic <id> [page] [locale]
      ranking [video|actress] [locale]
    """
    if len(argv) < 2:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "usage: scrape_whos.py <mode> ...",
                },
                ensure_ascii=False,
            )
        )
        return 2
    mode = argv[1].lower()
    try:
        if mode in {"categories", "cats"}:
            locale = argv[2] if len(argv) > 2 else "zh"
            data = scrape_frame_categories(locale)
        elif mode == "frames":
            type_slug = argv[2] if len(argv) > 2 and argv[2] not in {"-", ""} else ""
            label_raw = argv[3] if len(argv) > 3 and argv[3] not in {"-", ""} else ""
            page = int(argv[4]) if len(argv) > 4 else 1
            locale = argv[5] if len(argv) > 5 else "zh"
            label_id = int(label_raw) if str(label_raw).isdigit() else None
            data = scrape_frames(
                type_slug=type_slug,
                label_id=label_id,
                page=page,
                locale=locale,
            )
        elif mode == "frame":
            fid = argv[2] if len(argv) > 2 else ""
            locale = argv[3] if len(argv) > 3 else "zh"
            data = scrape_frame_detail(fid, locale)
        elif mode == "topics":
            cat = argv[2] if len(argv) > 2 and argv[2] not in {"-", ""} else ""
            page = int(argv[3]) if len(argv) > 3 else 1
            locale = argv[4] if len(argv) > 4 else "zh"
            data = scrape_topics(category=cat, page=page, locale=locale)
        elif mode == "topic":
            tid = argv[2] if len(argv) > 2 else ""
            page = int(argv[3]) if len(argv) > 3 else 1
            locale = argv[4] if len(argv) > 4 else "zh"
            data = scrape_topic_detail(tid, page, locale)
        elif mode == "ranking":
            kind = argv[2] if len(argv) > 2 else "video"
            locale = argv[3] if len(argv) > 3 else "zh"
            data = scrape_ranking(kind, locale)
        else:
            data = {"ok": False, "error": f"unknown mode {mode}"}
    except Exception as e:
        data = {"ok": False, "error": str(e)}
    print(json.dumps(data, ensure_ascii=False))
    return 0 if data.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
