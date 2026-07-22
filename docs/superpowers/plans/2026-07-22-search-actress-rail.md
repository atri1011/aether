# Search Actress Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When search text fuzzy-matches actress names, show a top avatar rail on the search page that links to each actress’s works page; keep video results + filter/sort below.

**Architecture:** Add `GET /api/actresses/search` backed by Python scrape + fuzzy filter. Frontend `SearchPage` loads actresses in parallel with videos and renders a horizontal `ActressRail` above the existing `VideoFilterBar` / `VideoGrid`. Click reuses `/actress/:slug` (already has works filters).

**Tech Stack:** Express (`server/index.js`), Python `curl_cffi` scrape (`server/py/scrape_actresses.py`), React 19 + react-router 7, existing CSS tokens in `src/index.css`, Motion already in app (no new deps).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-search-actress-rail-design.md`
- Fuzzy match only; no exact-only mode.
- Filters/sort on search page remain **video-only**.
- Register `/api/actresses/search` **before** `/api/actresses/:slug`.
- Actress API failure must not break video search (empty rail).
- Reuse `ActressSummary` / `ActressCard`; do not re-theme global colors from design-system red palette.
- No new npm dependencies.
- No jest/vitest in repo — verify with Python unit checks, `npx tsc -b`, `npm run lint`, and manual API/UI checks.

---

## File map

| File | Responsibility |
|------|----------------|
| `server/py/scrape_actresses.py` | `normalize_name`, `fuzzy_score`, `scrape_search`, CLI `search` mode |
| `server/pybridge.js` | `pyScrapeActressesSearch({ q, locale, limit })` |
| `server/index.js` | `GET /api/actresses/search` + cache |
| `src/lib/api.ts` | `api.actressSearch` |
| `src/i18n.ts` | `actressMatches` zh/en |
| `src/components/ActressRail.tsx` | Horizontal rail UI |
| `src/components/Skeleton.tsx` | `ActressRailSkeleton` |
| `src/index.css` | `.actress-rail*` styles |
| `src/pages/SearchPage.tsx` | Parallel fetch + rail render |

---

### Task 1: Python fuzzy match + scrape_search

**Files:**
- Modify: `server/py/scrape_actresses.py`
- Test: run inline Python asserts (no new test framework)

**Interfaces:**
- Produces:
  - `normalize_name(s: str) -> str`
  - `fuzzy_score(query: str, name: str, slug: str = "") -> int`  
    returns `0` = no match; higher is better (`100` exact, `80` prefix, `50` substring on name; slug-only substring `40`)
  - `scrape_search(q: str, locale: str = "zh", limit: int = 12) -> dict`  
    shape: `{ ok, query, items: list[actress dict], count, mode: "search", source }`
  - CLI: `python scrape_actresses.py search <q> <locale> <limit>`

- [ ] **Step 1: Add pure helpers near top of `scrape_actresses.py` (after `_clean_text`)**

Insert after `_clean_text`:

```python
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
```

- [ ] **Step 2: Verify helpers with a one-shot Python check**

Run from `server/py`:

```bash
cd "D:/Code/论文/aether/server/py" && python -c "
from scrape_actresses import normalize_name, fuzzy_score
assert normalize_name('三上 悠亜') == '三上悠亜'
assert normalize_name('Yua-Mikami') == 'yuamikami'
assert fuzzy_score('三上', '三上悠亜', 'yua-mikami') == 50
assert fuzzy_score('三上悠亜', '三上悠亜', 'yua-mikami') == 100
assert fuzzy_score('yua', '三上悠亜', 'yua-mikami') == 40
assert fuzzy_score('zzz', '三上悠亜', 'yua-mikami') == 0
print('ok')
"
```

Expected: `ok`

- [ ] **Step 3: Implement `scrape_search`**

Add before `main()`:

```python
def scrape_search(q: str, locale: str = "zh", limit: int = 12) -> dict:
    """Fuzzy actress search: try keyword list URLs, then filter multi-page directory."""
    q = _clean_text(q or "")
    if not q:
        return {"ok": False, "error": "q required", "items": [], "count": 0}
    try:
        limit = max(1, min(int(limit or 12), 24))
    except (TypeError, ValueError):
        limit = 12

    loc = normalize_locale(locale)
    scored: dict[str, tuple[int, dict]] = {}

    def ingest(items: list[dict]):
        for it in items or []:
            slug = (it.get("slug") or "").strip()
            if not slug:
                continue
            sc = fuzzy_score(q, it.get("name") or "", slug)
            if sc <= 0:
                continue
            prev = scored.get(slug)
            # keep higher score; tie-break richer videoCount
            if prev is None or sc > prev[0]:
                scored[slug] = (sc, it)
            elif sc == prev[0]:
                pv = prev[1].get("videoCount")
                cv = it.get("videoCount")
                if cv is not None and (pv is None or cv > pv):
                    scored[slug] = (sc, it)

    # 1) Probe keyword-style actress listing URLs (best effort)
    encoded_q = quote(q, safe="")
    probe_paths = [
        f"actresses?q={encoded_q}",
        f"actresses?keyword={encoded_q}",
        f"search/{encoded_q}",
    ]
    # candidate_urls expects path without leading ? — use path + query via query dict instead
    for page in (1,):
        urls = candidate_urls("actresses", page, loc, {"q": q})
        urls += candidate_urls("actresses", page, loc, {"keyword": q})
        # Also try site search pages that might embed actress cards
        for host in bases():
            sl = site_locale(loc)
            if sl == "cn":
                urls.append(f"{host}/cn/search/{encoded_q}")
                urls.append(f"{host}/search/{encoded_q}")
            else:
                urls.append(f"{host}/{sl}/search/{encoded_q}")

        def parse_probe(html: str):
            items = parse_actress_cards(html)
            return {"items": items} if items else None

        probed = fetch_first_ok(urls, parse_probe)
        if probed.get("ok"):
            ingest(probed.get("items") or [])

    # 2) Fallback: first pages of actress directory sorted by videos
    if len(scored) < limit:
        for page in (1, 2, 3):
            listed = scrape_list(page, loc, sort="videos")
            if not listed.get("ok"):
                break
            ingest(listed.get("items") or [])
            if len(scored) >= limit * 2:
                break

    ranked = sorted(
        scored.values(),
        key=lambda pair: (
            -pair[0],
            -(pair[1].get("videoCount") or -1),
            pair[1].get("name") or "",
        ),
    )
    items = [it for _, it in ranked[:limit]]
    return {
        "ok": True,
        "query": q,
        "items": items,
        "count": len(items),
        "mode": "search",
        "source": "scrape",
        "locale": loc,
    }
```

Note: if `candidate_urls("actresses", page, loc, {"q": q})` already covers keyword probes, keep the extra host search URLs — empty parse is fine.

- [ ] **Step 4: Wire CLI `search` mode in `main()`**

Replace the mode branch so `search` is handled before the default `list` branch:

```python
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
        limit = int(sys.argv[4]) if len(sys.argv) > 4 else 12
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
```

Update the comment at top of `main()` to include:

```python
    # search: search q locale limit
```

- [ ] **Step 5: Smoke-test search mode (network)**

```bash
cd "D:/Code/论文/aether/server/py" && python scrape_actresses.py search 三上 zh 8
```

Expected: JSON with `"ok": true` and `items` array (may be empty if upstream blocked — helpers must still work). If network fails, confirm script exits with JSON error, not traceback.

- [ ] **Step 6: Commit**

```bash
git add server/py/scrape_actresses.py
git commit -m "feat(scrape): add fuzzy actress search mode"
```

---

### Task 2: Bridge + Express route

**Files:**
- Modify: `server/pybridge.js`
- Modify: `server/index.js`

**Interfaces:**
- Consumes: CLI `search q locale limit` from Task 1
- Produces:
  - `pyScrapeActressesSearch({ q, locale, limit }) -> Promise<object>`
  - `GET /api/actresses/search?q=&locale=&limit=` → JSON `{ query, items, count, source, matchedBy }`

- [ ] **Step 1: Add bridge helper in `server/pybridge.js` after `pyScrapeActressDetail`**

```js
export function pyScrapeActressesSearch(opts = {}) {
  const { q = '', locale = 'zh', limit = 12 } = opts
  const loc = String(locale || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh'
  const lim = Math.max(1, Math.min(Number(limit) || 12, 24))
  return runPython(
    'scrape_actresses.py',
    ['search', String(q || ''), loc, String(lim)],
    { timeoutMs: 60000 },
  )
}
```

- [ ] **Step 2: Import bridge symbol in `server/index.js`**

Extend the existing import from `./pybridge.js`:

```js
import {
  pyScrapeList,
  pyScrapeActressesList,
  pyScrapeActressesRanking,
  pyScrapeActressDetail,
  pyScrapeActressesSearch,
} from './pybridge.js'
```

- [ ] **Step 3: Add route BEFORE `app.get('/api/actresses/:slug', ...)`**

Place immediately after `app.get('/api/actresses', ...)` block ends (before `:slug`):

```js
app.get('/api/actresses/search', async (req, res) => {
  const locale = localeOf(req)
  const q = String(req.query.q || '').trim()
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12))
  if (!q) return sendError(res, 400, 'CONFIG', 'q is required')

  const key = `actresses:search:v1:${locale}:${q.toLowerCase()}:${limit}`
  try {
    const { data, cache } = await withCache(key, config.ttl.browse, async () => {
      try {
        const scraped = await pyScrapeActressesSearch({ q, locale, limit })
        const items = scraped?.ok ? scraped.items || [] : []
        return {
          query: q,
          items,
          count: items.length,
          source: scraped?.source || 'scrape',
          matchedBy: 'fuzzy',
          url: scraped?.url,
        }
      } catch (e) {
        // Prefer empty rail over 503 so search page still works
        return {
          query: q,
          items: [],
          count: 0,
          source: 'error',
          matchedBy: 'fuzzy',
          error: e.message,
        }
      }
    })
    res.setHeader('X-Aether-Cache', cache)
    res.json(data)
  } catch (e) {
    res.json({
      query: q,
      items: [],
      count: 0,
      source: 'error',
      matchedBy: 'fuzzy',
      error: e.message,
    })
  }
})
```

- [ ] **Step 4: Start server and hit the route**

```bash
# if not already running
cd "D:/Code/论文/aether" && node server/index.js
```

In another shell:

```bash
curl -s "http://127.0.0.1:8787/api/actresses/search?q=%E4%B8%89%E4%B8%8A&locale=zh&limit=8" | head -c 800
```

(Use the project’s actual port from `server/config.js` if not 8787 — check `config.port`.)

Expected: JSON with `items` array and `matchedBy: "fuzzy"`. Empty items acceptable if upstream blocked.

Also verify slug route still works:

```bash
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8787/api/actresses/filters?locale=zh"
```

Expected: `200`

- [ ] **Step 5: Commit**

```bash
git add server/pybridge.js server/index.js
git commit -m "feat(server): add GET /api/actresses/search"
```

---

### Task 3: Client API + i18n

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/i18n.ts`

**Interfaces:**
- Produces:
  - `api.actressSearch(q: string, locale: Locale, limit?: number): Promise<{ query: string; items: ActressSummary[]; count: number; matchedBy?: string; source?: string }>`
  - i18n key `actressMatches`: zh `相关女优`, en `Actresses`

- [ ] **Step 1: Add `actressSearch` on `api` object in `src/lib/api.ts`**

Place after `actresses` / before `actressDetail`:

```ts
  actressSearch: (q: string, locale: Locale, limit = 12) => {
    const p = new URLSearchParams()
    p.set('q', q)
    p.set('locale', locale)
    p.set('limit', String(limit))
    return getJson<{
      query: string
      items: ActressSummary[]
      count: number
      matchedBy?: string
      source?: string
    }>(`/api/actresses/search?${p.toString()}`, locale)
  },
```

- [ ] **Step 2: Add i18n strings in `src/i18n.ts`**

In `zh` block (near actress keys):

```ts
    actressMatches: '相关女优',
```

In `en` block:

```ts
    actressMatches: 'Actresses',
```

- [ ] **Step 3: Typecheck**

```bash
cd "D:/Code/论文/aether" && npx tsc -b --pretty false
```

Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/i18n.ts
git commit -m "feat(api): wire actressSearch client + i18n"
```

---

### Task 4: ActressRail UI + skeleton + CSS

**Files:**
- Create: `src/components/ActressRail.tsx`
- Modify: `src/components/Skeleton.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `ActressSummary`, `ActressCard`, `tr('actressMatches')`
- Produces:
  - `ActressRail({ items, title }: { items: ActressSummary[]; title: string })`
  - `ActressRailSkeleton({ count?: number })`

- [ ] **Step 1: Create `src/components/ActressRail.tsx`**

```tsx
import type { ActressSummary } from '../types'
import { ActressCard } from './ActressCard'

export function ActressRail({
  items,
  title,
}: {
  items: ActressSummary[]
  title: string
}) {
  if (!items.length) return null

  return (
    <section className="actress-rail section" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="card-sub">{items.length}</span>
      </div>
      <div className="actress-rail-track">
        {items.map((a, i) => (
          <div className="actress-rail-item" key={a.slug}>
            <ActressCard actress={a} index={i} />
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add skeleton in `src/components/Skeleton.tsx`**

```tsx
export function ActressRailSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="actress-rail-track" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="actress-rail-item" key={i} style={{ textAlign: 'center' }}>
          <div className="skeleton skeleton-avatar" style={{ width: 88, height: 88, margin: '0 auto' }} />
          <div
            className="skeleton skeleton-line"
            style={{ width: '4.5rem', margin: '0.55rem auto 0' }}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Add CSS after existing `.actress-sub` block in `src/index.css`**

```css
/* ── Actress search rail ───────────────────────────────── */

.actress-rail {
  margin-bottom: 0.25rem;
}

.actress-rail-track {
  display: flex;
  gap: 1rem 0.85rem;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  padding: 0.15rem 0.1rem 0.85rem;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}

.actress-rail-track::-webkit-scrollbar {
  height: 6px;
}

.actress-rail-track::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink-dim) 55%, transparent);
  border-radius: 999px;
}

.actress-rail-item {
  flex: 0 0 auto;
  scroll-snap-align: start;
  width: 112px;
}

.actress-rail-item .actress-avatar {
  width: 88px;
  height: 88px;
}

.actress-rail-item .actress-name {
  max-width: 7rem;
  font-size: 0.84rem;
}

@media (max-width: 640px) {
  .actress-rail-item {
    width: 100px;
  }
  .actress-rail-item .actress-avatar {
    width: 80px;
    height: 80px;
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
cd "D:/Code/论文/aether" && npx tsc -b --pretty false
```

Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/components/ActressRail.tsx src/components/Skeleton.tsx src/index.css
git commit -m "feat(ui): add ActressRail and skeleton styles"
```

---

### Task 5: Integrate SearchPage

**Files:**
- Modify: `src/pages/SearchPage.tsx`

**Interfaces:**
- Consumes: `api.actressSearch`, `ActressRail`, `ActressRailSkeleton`, `tr('actressMatches')`
- Produces: search page with rail above video filters

- [ ] **Step 1: Replace `SearchPage.tsx` with integrated version**

Full file:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { ActressSummary, VideoFilterOptions } from '../types'
import { useLocale } from '../context'
import { VideoGrid } from '../components/VideoGrid'
import { InfiniteSentinel } from '../components/InfiniteSentinel'
import { usePagedList } from '../hooks/usePagedList'
import { VideoFilterBar } from '../components/VideoFilterBar'
import { useVideoListQuery } from '../hooks/useVideoListQuery'
import { ActressRail } from '../components/ActressRail'
import { ActressRailSkeleton, VideoSkeletonGrid } from '../components/Skeleton'

export function SearchPage() {
  const { locale, tr } = useLocale()
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim()
  const { query, setQuery } = useVideoListQuery({ sort: 'released_at' })
  const [filterOptions, setFilterOptions] = useState<VideoFilterOptions | null>(null)
  const [actresses, setActresses] = useState<ActressSummary[]>([])
  const [actressesLoading, setActressesLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .videoFilters(locale)
      .then((d) => {
        if (!cancelled) setFilterOptions(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locale])

  // Actress rail — independent of video filters/sort
  useEffect(() => {
    if (!q) {
      setActresses([])
      setActressesLoading(false)
      return
    }
    let cancelled = false
    setActressesLoading(true)
    api
      .actressSearch(q, locale, 12)
      .then((d) => {
        if (!cancelled) setActresses(d.items || [])
      })
      .catch(() => {
        if (!cancelled) setActresses([])
      })
      .finally(() => {
        if (!cancelled) setActressesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q, locale])

  const loader = useCallback(
    async (page: number) => {
      if (!q) return { items: [], page, pageSize: 24, hasMore: false }
      const d = await api.searchPage(q, locale, page, 24, query)
      if (d.filterOptions) setFilterOptions(d.filterOptions)
      const hasMore =
        typeof d.hasMore === 'boolean'
          ? d.hasMore
          : (d.items?.length || 0) >= Math.min(d.pageSize || 24, 12)
      return {
        items: d.items || [],
        page: d.page || page,
        pageSize: d.pageSize || 24,
        hasMore,
      }
    },
    [q, locale, query],
  )

  const { items, loading, loadingMore, error, hasMore, loadMore } = usePagedList(loader, [
    q,
    locale,
    query.filters,
    query.sort,
  ])

  if (!q) return <div className="state">{tr('searchPlaceholder')}</div>
  if (error && !items.length && !actressesLoading && !actresses.length) {
    return <div className="state error">{error}</div>
  }

  return (
    <>
      <section className="section">
        <div className="section-head">
          <h2>
            {tr('search')}: {q}
          </h2>
          <span className="card-sub">{items.length ? `${items.length}+` : ''}</span>
        </div>
      </section>

      {actressesLoading && !actresses.length ? (
        <section className="section actress-rail" aria-busy="true">
          <div className="section-head">
            <h2>{tr('actressMatches')}</h2>
          </div>
          <ActressRailSkeleton count={6} />
        </section>
      ) : (
        <ActressRail items={actresses} title={tr('actressMatches')} />
      )}

      <section className="section">
        <VideoFilterBar options={filterOptions} value={query} onChange={setQuery} />
        {loading && !items.length ? (
          <VideoSkeletonGrid count={12} />
        ) : items.length ? (
          <VideoGrid items={items} />
        ) : (
          !error && <div className="state">{tr('empty')}</div>
        )}
        {error && items.length > 0 && <div className="state error">{error}</div>}
        <InfiniteSentinel
          onVisible={loadMore}
          disabled={!hasMore}
          loading={loadingMore}
          label={tr('loadMore')}
          loadingLabel={tr('loadingMore')}
        />
        {!hasMore && items.length > 0 && (
          <div className="state" style={{ padding: '1.25rem' }}>
            {tr('endOfList')}
          </div>
        )}
      </section>
    </>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
cd "D:/Code/论文/aether" && npx tsc -b --pretty false && npm run lint
```

Expected: both exit 0

- [ ] **Step 3: Manual UI check**

1. `npm run dev`
2. Search a known actress substring → rail shows avatars → click opens profile with works + filter bar.
3. Change video filter on search page → rail does **not** flash reload.
4. Search garbage string → no rail (or empty), videos empty/normal.
5. Mobile width: rail scrolls horizontally; page body does not.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat(search): show matching actress rail above video results"
```

---

### Task 6: End-to-end acceptance pass

**Files:** none (verification only)

- [ ] **Step 1: Run acceptance checklist from spec §9**

| # | Check | Pass? |
|---|--------|-------|
| 1 | Fuzzy name search shows avatar rail | |
| 2 | Click avatar → `/actress/:slug` works list + filters | |
| 3 | Video filter/sort does not re-fetch actresses | |
| 4 | Product-code-only query: rail hidden or empty | |
| 5 | Actress API error: videos still render | |
| 6 | 375px: horizontal rail only, no body overflow-x | |
| 7 | Keyboard focus on cards works | |
| 8 | `tsc` + `lint` clean | |

- [ ] **Step 2: If any fail, fix in the owning file and amend/fix-commit with a clear message**

- [ ] **Step 3: Final commit only if uncommitted fixes remain**

```bash
git status
# if clean, done; else commit remaining fixes
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Top actress rail + videos | Task 5 |
| Fuzzy match | Task 1 |
| Click → actress detail with filters | reuse + Task 5 |
| Video filters only on search | Task 5 (rail independent of `query`) |
| Dedicated search API | Task 2 |
| Approach A | all tasks |
| Cache + fail-soft | Task 2 |
| Route before `:slug` | Task 2 |
| i18n | Task 3 |
| Skeleton / CSS / a11y | Task 4–5 |
| Max ~12 items | Task 1 limit + Task 5 `limit=12` |
| No autocomplete / no actress filters on search | out of scope (not implemented) |

## Placeholder scan

No TBD / “implement later” steps. All code blocks are concrete.

## Type consistency

- `ActressSummary` fields: `slug`, `name`, `avatarUrl`, optional `actressId`, `videoCount`, `debutYear`, `rank` — used consistently.
- `api.actressSearch(q, locale, limit?)` matches server query params.
- i18n key `actressMatches` used in SearchPage + rail title.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-search-actress-rail.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, batch with checkpoints  

Which approach?
