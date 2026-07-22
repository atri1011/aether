#!/usr/bin/env python3
"""Scrape MissAV actress list / ranking / detail video grids."""
from __future__ import annotations

import json
import re
import sys
from urllib.parse import quote, unquote, urlencode

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi not installed"}))
    sys.exit(2)

# Reuse video-list parser helpers from scrape_list
from scrape_list import SKIP, base_id, parse_items  # type: ignore

LOCALE_MAP = {
    "zh": "cn",
    "cn": "cn",
    "en": "en",
    "ja": "ja",
}


def normalize_locale(locale: str) -> str:
    loc = (locale or "zh").lower()
    if loc.startswith("en"):
        return "en"
    if loc.startswith("ja"):
        return "ja"
    return "zh"


def site_locale(locale: str) -> str:
    return LOCALE_MAP.get(normalize_locale(locale), "cn")


def bases() -> list[str]:
    return [
        "https://missav.ai",
        "https://missav.ws",
    ]


# Cloudflare often challenges bare GETs; a same-site Referer unlocks /search/*.
DEFAULT_HEADERS = {
    "Referer": "https://missav.ai/",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def candidate_urls(path: str, page: int, locale: str, query: dict | None = None) -> list[str]:
    """Build missav actress listing URLs (cn for zh, en for en)."""
    path = path.strip("/")
    loc = site_locale(locale)
    qs = dict(query or {})
    if page > 1:
        qs["page"] = str(page)
    qstr = ("?" + urlencode(qs)) if qs else ""
    has_filters = bool(qs)

    urls: list[str] = []
    for host in bases():
        # Prefer localized paths first — bare /actresses?filters often 403s
        if loc == "cn":
            urls.append(f"{host}/cn/{path}{qstr}")
            urls.append(f"{host}/dm14/cn/{path}{qstr}")
            urls.append(f"{host}/zh/{path}{qstr}")
            if not has_filters:
                urls.append(f"{host}/{path}{qstr}")
            urls.append(f"{host}/dm14/{path}{qstr}")
        else:
            urls.append(f"{host}/{loc}/{path}{qstr}")
            urls.append(f"{host}/dm14/{loc}/{path}{qstr}")
    return urls


def search_candidate_urls(q: str, locale: str) -> list[str]:
    """MissAV search page URLs that embed the actress avatar rail (same as site UI)."""
    encoded_q = quote(q, safe="")
    loc = site_locale(locale)
    urls: list[str] = []
    for host in bases():
        if loc == "cn":
            urls += [
                f"{host}/cn/search/{encoded_q}",
                f"{host}/search/{encoded_q}",
            ]
        else:
            urls += [
                f"{host}/{loc}/search/{encoded_q}",
                f"{host}/search/{encoded_q}",
            ]
    return urls


def _clean_text(s: str) -> str:
    return (
        (s or "")
        .replace("&#039;", "'")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("\xa0", " ")
        .strip()
    )


def normalize_name(s: str) -> str:
    """Lowercase + strip spaces/separators for fuzzy compare."""
    s = _clean_text(s or "").lower()
    for ch in (" ", "　", "·", "・", "-", "_", ".", "　"):
        s = s.replace(ch, "")
    return s


def fuzzy_score(query: str, name: str, slug: str = "") -> int:
    """0 = no match; higher = better. Exact > prefix > substring; slug weaker than name."""
    q = normalize_name(query)
    if not q:
        return 0
    n = normalize_name(name)
    sl = normalize_name(slug.replace("-", " "))
    if n and n == q:
        return 100
    if n and n.startswith(q):
        return 80
    if n and q in n:
        return 50
    if sl and (sl == q or sl.startswith(q) or q in sl):
        return 40
    return 0


def parse_actress_cards(html: str) -> list[dict]:
    """Parse actress directory / ranking cards from HTML."""
    by_slug: dict[str, dict] = {}
    order: list[str] = []

    def score(it: dict) -> int:
        s = 0
        if it.get("videoCount") is not None:
            s += 4
        if it.get("debutYear") is not None:
            s += 2
        if it.get("rank") is not None:
            s += 3
        if it.get("name") and it["name"] != it.get("slug"):
            s += 1
        if it.get("avatarUrl"):
            s += 1
        return s

    def push(slug: str, avatar: str, actress_id: str, name: str, context: str):
        slug = unquote(slug or "").strip()
        if not slug or slug.lower() in {"ranking", "actresses"}:
            return
        name = _clean_text(name) or ""
        video_count = None
        debut_year = None
        rank = None

        m_vc = re.search(r"(\d[\d,]*)\s*(?:条影片|videos?|作品)", context, re.I)
        if m_vc:
            video_count = int(m_vc.group(1).replace(",", ""))
        m_d = re.search(r"(\d{4})\s*(?:出道|debut)", context, re.I)
        if m_d:
            debut_year = int(m_d.group(1))
        m_r = re.search(r"第\s*(\d+)\s*名|#\s*(\d+)|rank\s*[#:]?\s*(\d+)", context, re.I)
        if m_r:
            rank = int(next(g for g in m_r.groups() if g))

        avatar = avatar or (
            f"https://fourhoi.com/actress/{actress_id}-t.jpg" if actress_id else ""
        )
        cand = {
            "slug": slug,
            "name": name or slug,
            "avatarUrl": avatar,
            "actressId": str(actress_id or ""),
            "videoCount": video_count,
            "debutYear": debut_year,
            "rank": rank,
        }
        prev = by_slug.get(slug)
        if prev is None:
            by_slug[slug] = cand
            order.append(slug)
            return
        # merge: keep richer fields
        merged = {
            "slug": slug,
            "name": prev["name"] if prev["name"] != slug else cand["name"],
            "avatarUrl": prev["avatarUrl"] or cand["avatarUrl"],
            "actressId": prev["actressId"] or cand["actressId"],
            "videoCount": prev["videoCount"]
            if prev["videoCount"] is not None
            else cand["videoCount"],
            "debutYear": prev["debutYear"]
            if prev["debutYear"] is not None
            else cand["debutYear"],
            "rank": prev["rank"] if prev["rank"] is not None else cand["rank"],
        }
        # prefer higher score name source
        if score(cand) > score(prev) and cand["name"] and cand["name"] != slug:
            merged["name"] = cand["name"]
            if cand["avatarUrl"]:
                merged["avatarUrl"] = cand["avatarUrl"]
            if cand["actressId"]:
                merged["actressId"] = cand["actressId"]
        by_slug[slug] = merged

    # Primary: full <li> cards (portrait + meta together)
    chunks = re.split(r"(?=<li[\s>])", html)
    for chunk in chunks:
        if "fourhoi.com/actress/" not in chunk:
            continue
        m = re.search(
            r'href="(?:https?://[^"]+)?(?:/dm\d+)?/(?:cn|en|zh|ja)?/?actresses/([^"#?]+)"',
            chunk,
            re.I,
        )
        if not m:
            continue
        slug = m.group(1)
        if unquote(slug).lower() in {"ranking"}:
            continue
        img = re.search(
            r'<img[^>]+src="(https://fourhoi\.com/actress/(\d+)[^"]*)"[^>]*(?:alt="([^"]*)")?',
            chunk,
            re.I,
        )
        if not img:
            img = re.search(
                r'<img[^>]+alt="([^"]*)"[^>]+src="(https://fourhoi\.com/actress/(\d+)[^"]*)"',
                chunk,
                re.I,
            )
            if not img:
                continue
            name, avatar, aid = img.group(1), img.group(2), img.group(3)
        else:
            avatar, aid, name = img.group(1), img.group(2), img.group(3) or ""

        h4 = re.search(r"<h4[^>]*>\s*([^<]+?)\s*</h4>", chunk, re.I)
        if h4:
            name = h4.group(1)
        push(slug, avatar, aid, name, chunk)

    # Fallback if list markup differs
    if len(by_slug) < 3:
        for m in re.finditer(
            r'href="(?:https?://[^"]+)?(?:/dm\d+)?/(?:cn|en|zh|ja)?/?actresses/([^"#?]+)"[^>]*>'
            r'[\s\S]{0,400}?<img[^>]+src="(https://fourhoi\.com/actress/(\d+)[^"]*)"[^>]*'
            r'(?:alt="([^"]*)")?',
            html,
            re.I,
        ):
            slug, avatar, aid, alt = m.group(1), m.group(2), m.group(3), m.group(4) or ""
            ctx = html[m.start() : m.start() + 1200]
            h4 = re.search(r"<h4[^>]*>\s*([^<]+?)\s*</h4>", ctx, re.I)
            name = h4.group(1) if h4 else alt
            push(slug, avatar, aid, name, ctx)

    items = [by_slug[s] for s in order if s in by_slug]
    return items


def parse_actress_profile(html: str) -> dict:
    """Extract profile meta from actress detail page."""
    name = ""
    h1 = re.search(r"<h1[^>]*>\s*([^<]+?)\s*</h1>", html, re.I)
    if h1:
        name = _clean_text(h1.group(1))
        # strip "出演的 AV..."
        name = re.sub(r"(出演的|出演|出演作品|AV).*$", "", name).strip()
        name = re.sub(r"\s*-\s*MissAV.*$", "", name, flags=re.I).strip()

    avatar = ""
    m_av = re.search(r'(https://fourhoi\.com/actress/\d+(?:-t)?\.jpg)', html, re.I)
    if m_av:
        avatar = m_av.group(1)

    # Body stats e.g. 160cm / 34D - 24 - 35
    stats = None
    m_stats = re.search(
        r"(\d{2,3})\s*cm\s*/\s*([0-9]{2}[A-Q]?)\s*[-–]\s*(\d{2})\s*[-–]\s*(\d{2})",
        html,
        re.I,
    )
    if m_stats:
        stats = {
            "heightCm": int(m_stats.group(1)),
            "bust": m_stats.group(2),
            "waist": m_stats.group(3),
            "hip": m_stats.group(4),
            "raw": m_stats.group(0).replace("–", "-"),
        }

    birthday = None
    age = None
    m_b = re.search(r"(\d{4}-\d{2}-\d{2})\s*(?:\((\d+)\s*岁\))?", html)
    if m_b:
        birthday = m_b.group(1)
        if m_b.group(2):
            age = int(m_b.group(2))

    return {
        "name": name,
        "avatarUrl": avatar,
        "stats": stats,
        "birthday": birthday,
        "age": age,
    }


def _http_get(url: str, *, retries: int = 1):
    """GET with browser impersonation + site Referer; optional short retries on CF 403."""
    import time

    last_err = "request failed"
    attempts = max(1, int(retries or 1))
    for i in range(attempts):
        try:
            r = requests.get(
                url,
                impersonate="chrome131",
                timeout=30,
                allow_redirects=True,
                headers=DEFAULT_HEADERS,
            )
        except Exception as e:
            last_err = str(e)
            if i + 1 < attempts:
                time.sleep(0.6 + i * 0.5)
                continue
            return None, last_err
        if r.status_code == 200 and r.text and len(r.text) > 5000:
            return r, None
        last_err = f"status {r.status_code}"
        # CF challenge pages are tiny; brief backoff then retry same URL
        if r.status_code in {403, 503, 429} and i + 1 < attempts:
            time.sleep(0.8 + i * 0.7)
            continue
        break
    return None, last_err


def fetch_first_ok(urls: list[str], parse_fn, *, retries: int = 1):
    last = {"ok": False, "error": "no candidate succeeded"}
    for url in urls:
        r, err = _http_get(url, retries=retries)
        if r is None:
            last = {"ok": False, "error": err or "request failed", "url": url}
            continue
        try:
            parsed = parse_fn(r.text)
        except Exception as e:
            last = {"ok": False, "error": f"parse: {e}", "url": str(r.url)}
            continue
        if not parsed:
            last = {"ok": False, "error": "no items parsed", "url": str(r.url)}
            continue
        return {"ok": True, "url": str(r.url), "raw_html_len": len(r.text), **parsed}
    return last


def scrape_list(
    page: int = 1,
    locale: str = "zh",
    *,
    sort: str | None = None,
    height: str | None = None,
    cup: str | None = None,
    age: str | None = None,
    debut: str | None = None,
) -> dict:
    query = {}
    if sort:
        query["sort"] = sort
    if height:
        query["height"] = height
    if cup:
        query["cup"] = cup
    if age:
        query["age"] = age
    if debut:
        query["debut"] = debut

    urls = candidate_urls("actresses", page, locale, query)

    def parse(html: str):
        items = parse_actress_cards(html)
        if not items:
            return None
        return {
            "items": items,
            "count": len(items),
            "page": page,
            "mode": "list",
            "filters": {
                "sort": sort or "videos",
                "height": height or "",
                "cup": cup or "",
                "age": age or "",
                "debut": debut or "",
            },
        }

    result = fetch_first_ok(urls, parse)
    result.setdefault("page", page)
    result.setdefault("locale", normalize_locale(locale))
    return result


def scrape_ranking(locale: str = "zh") -> dict:
    urls = candidate_urls("actresses/ranking", 1, locale)

    def parse(html: str):
        items = parse_actress_cards(html)
        if not items:
            return None
        # ranking is top ~100, no pagination on site — force sequential rank
        for i, it in enumerate(items):
            it["rank"] = i + 1
        # period label e.g. JUL 2026
        period = ""
        m3 = re.search(
            r"((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4})",
            html,
            re.I,
        )
        if m3:
            period = m3.group(1).upper()
        loc = normalize_locale(locale)
        if loc == "en":
            title = f"Actress Ranking {period}".strip()
        else:
            title = f"女优排行 {period}".strip()
        return {
            "items": items,
            "count": len(items),
            "page": 1,
            "mode": "ranking",
            "title": title,
            "period": period,
            "filters": {},
        }

    result = fetch_first_ok(urls, parse)
    result.setdefault("locale", normalize_locale(locale))
    return result


def scrape_detail(
    slug: str,
    page: int = 1,
    locale: str = "zh",
    *,
    sort: str | None = None,
    filt: str | None = None,
) -> dict:
    slug = unquote(slug or "").strip()
    if not slug:
        return {"ok": False, "error": "slug required"}

    # path segment may be raw JP characters
    encoded = quote(slug, safe="")
    query = {}
    if sort:
        query["sort"] = sort
    if filt:
        query["filter"] = filt
    if page > 1:
        query["page"] = str(page)

    loc = site_locale(locale)
    urls: list[str] = []
    for host in bases():
        for name in (encoded, slug):
            if loc == "cn":
                urls += [
                    f"{host}/actresses/{name}",
                    f"{host}/cn/actresses/{name}",
                    f"{host}/dm14/cn/actresses/{name}",
                ]
            else:
                urls += [
                    f"{host}/{loc}/actresses/{name}",
                    f"{host}/dm14/{loc}/actresses/{name}",
                ]
    # attach query
    if query:
        qstr = "?" + urlencode(query)
        urls = [u + qstr for u in urls]

    def parse(html: str):
        profile = parse_actress_profile(html)
        videos = parse_items(html)
        # filter junk ids that are navigation
        clean = []
        seen = set()
        for v in videos:
            i = (v.get("id") or "").lower()
            if not i or i in SKIP or i in seen:
                continue
            if i in {"actresses", "genres", "makers", "ranking"}:
                continue
            seen.add(i)
            clean.append(v)
        if not profile.get("name") and not clean:
            return None
        if not profile.get("name"):
            profile["name"] = slug
        return {
            "actress": {
                "slug": slug,
                **profile,
            },
            "items": clean,
            "count": len(clean),
            "page": page,
            "mode": "detail",
        }

    result = fetch_first_ok(urls, parse)
    result.setdefault("page", page)
    result.setdefault("locale", normalize_locale(locale))
    result.setdefault("slug", slug)
    return result


def scrape_search(q: str, locale: str = "zh", limit: int = 12) -> dict:
    """Actress search via MissAV /search/{q} page (same actress rail as the site).

    MissAV embeds matching actress avatar cards above video results on
    ``/{locale}/search/{keyword}``. We scrape that rail — not the actress
    directory (often CF-blocked, and ``?q=`` does not filter names).
    """
    q = _clean_text(q or "")
    if not q:
        return {"ok": False, "error": "q required", "items": [], "count": 0}
    try:
        limit = max(1, min(int(limit or 12), 24))
    except (TypeError, ValueError):
        limit = 12

    loc = normalize_locale(locale)
    scored: dict[str, tuple[int, dict]] = {}
    source_url = None

    def ingest(items: list[dict], *, require_fuzzy: bool):
        for it in items or []:
            slug = (it.get("slug") or "").strip()
            if not slug:
                continue
            sc = fuzzy_score(q, it.get("name") or "", slug)
            # MissAV search rail is already name-matched; still rank by score.
            # Directory fallback must require a positive fuzzy hit.
            if require_fuzzy and sc <= 0:
                continue
            if sc <= 0:
                sc = 1  # keep site-ordered rail entries even if normalize misses
            prev = scored.get(slug)
            if prev is None or sc > prev[0]:
                scored[slug] = (sc, it)
            elif sc == prev[0]:
                pv = prev[1].get("videoCount")
                cv = it.get("videoCount")
                if cv is not None and (pv is None or cv > pv):
                    scored[slug] = (sc, it)

    # 1) Primary: real MissAV search page actress rail (site UI parity)
    def parse_search_page(html: str):
        items = parse_actress_cards(html)
        # Empty rail is valid (e.g. code-only queries like SSIS-001) — only
        # reject clearly broken/challenge pages (tiny HTML / no search chrome).
        if "fourhoi.com" not in html and not items:
            return None
        # Challenge / block pages are short and lack listing chrome.
        if len(html) < 20000 and not items:
            return None
        return {"items": items or []}

    probed = fetch_first_ok(
        search_candidate_urls(q, loc),
        parse_search_page,
        retries=3,
    )
    if probed.get("ok"):
        source_url = probed.get("url")
        rail = probed.get("items") or []
        # Prefer site rail order: ingest with original order preserved via rank
        for i, it in enumerate(rail):
            if it.get("rank") is None:
                it = {**it, "rank": None}
            # stash rail order in a temp field via videoCount-stable sort later
            it = dict(it)
            it["_rail"] = i
            ingest([it], require_fuzzy=False)

    # 2) Fallback only when search page totally failed: ranking + fuzzy filter
    #    (directory /actresses is frequently CF 403 and not useful for search).
    if not scored:
        ranked_page = scrape_ranking(loc)
        if ranked_page.get("ok"):
            source_url = source_url or ranked_page.get("url")
            ingest(ranked_page.get("items") or [], require_fuzzy=True)

    # Prefer MissAV rail order (site UI parity); fuzzy score only as secondary.
    ranked = sorted(
        scored.values(),
        key=lambda pair: (
            pair[1].get("_rail", 10_000),
            -pair[0],
            -(pair[1].get("videoCount") or -1),
            pair[1].get("name") or "",
        ),
    )
    items = []
    for _, it in ranked[:limit]:
        clean = {k: v for k, v in it.items() if not str(k).startswith("_")}
        items.append(clean)

    return {
        "ok": True,
        "query": q,
        "items": items,
        "count": len(items),
        "mode": "search",
        "source": "scrape",
        "matchedBy": "missav-search" if items else "none",
        "locale": loc,
        "url": source_url,
    }


def main():
    # argv: mode [args...]
    # list: list page locale sort height cup age debut
    # ranking: ranking locale
    # detail: detail slug page locale sort filter
    # search: search q locale limit
    mode = sys.argv[1] if len(sys.argv) > 1 else "list"
    sys.stdout.reconfigure(encoding="utf-8")

    if mode == "ranking":
        locale = sys.argv[2] if len(sys.argv) > 2 else "zh"
        result = scrape_ranking(locale)
    elif mode == "detail":
        slug = sys.argv[2] if len(sys.argv) > 2 else ""
        page = int(sys.argv[3]) if len(sys.argv) > 3 else 1
        locale = sys.argv[4] if len(sys.argv) > 4 else "zh"
        sort = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] not in {"-", ""} else None
        filt = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] not in {"-", ""} else None
        result = scrape_detail(slug, page, locale, sort=sort, filt=filt)
    elif mode == "search":
        q = sys.argv[2] if len(sys.argv) > 2 else ""
        locale = sys.argv[3] if len(sys.argv) > 3 else "zh"
        try:
            limit = int(sys.argv[4]) if len(sys.argv) > 4 else 12
        except ValueError:
            limit = 12
        result = scrape_search(q, locale, limit)
    else:
        page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        locale = sys.argv[3] if len(sys.argv) > 3 else "zh"
        sort = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] not in {"-", ""} else None
        height = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] not in {"-", ""} else None
        cup = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] not in {"-", ""} else None
        age = sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] not in {"-", ""} else None
        debut = sys.argv[8] if len(sys.argv) > 8 and sys.argv[8] not in {"-", ""} else None
        result = scrape_list(
            page, locale, sort=sort, height=height, cup=cup, age=age, debut=debut
        )

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
