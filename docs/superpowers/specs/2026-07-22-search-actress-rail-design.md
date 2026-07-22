# Search Actress Rail — Design Spec

**Date:** 2026-07-22  
**Project:** Aether  
**Status:** Draft for approval  
**Related:** `design-system/aether-search/` (ui-ux-pro-max)

---

## 1. Goal

When a user searches with text that matches an actress name (fuzzy), the search results page must:

1. Show matching actresses as **avatar cards** at the top of the page.
2. Allow clicking an actress card to open **`/actress/:slug`** (existing detail page with full works + filter/sort).
3. Keep the existing **video results grid** below, with the existing **VideoFilterBar** (filters + sort).
4. Present the UI in Aether’s existing **modern dark / cinematic** visual language, guided by ui-ux-pro-max tokens (not a full re-theme).

Non-goals for this iteration:

- Autocomplete dropdown while typing in the header search box.
- Actress-side filters/sort on the search page.
- Merging actress payloads into the video `/api/search` response.
- Ranking page or actress directory changes beyond reuse of `ActressCard`.

---

## 2. Decisions (locked)

| Topic | Choice |
|-------|--------|
| Layout | Top **actress horizontal rail** + videos below |
| Name match | **Fuzzy** (substring / normalized contains) |
| Filters on search page | **Videos only** (existing `VideoFilterBar`) |
| Actress data source | **Dedicated actress search API** |
| Implementation path | **Approach A** — independent API + rail |

---

## 3. Approaches considered

### A — Independent actress search API + top rail (chosen)

- `GET /api/actresses/search?q=&locale=&limit=`
- `SearchPage` loads actress rail and video list **in parallel**.
- Pros: clear cache keys, no coupling to video scrape/recombee, reuses `ActressCard` + detail page, fail-soft (rail can be empty while videos still load).
- Cons: one extra request on search.

### B — Extend `/api/search` to return `{ actresses, items }`

- Pros: single round-trip.
- Cons: couples TTL/cache, forces both sources to fail or succeed together, harder partial loading.

### C — Client-only filter of `/api/actresses` pages

- Pros: no scrape work.
- Cons: poor recall, multi-page latency, not real search.

**Recommendation:** A.

---

## 4. UX / UI (ui-ux-pro-max)

### Visual system

Align with existing Aether tokens in `src/index.css` (glass borders, accent glow, stagger rise). Design-system file `design-system/aether-search/MASTER.md` is reference only — **do not replace** project CSS variables wholesale with the generated red cinema palette unless a later re-skin is requested. Prefer:

- Dark surface, high-contrast names, circular avatars (already `ActressCard`).
- Motion: existing `aether-rise` + small stagger (`--i`), 150–300ms hover, `prefers-reduced-motion` respected via existing globals.
- Touch: card hit target ≥ 44×44 (avatar is 96px; keep full card clickable).
- No emoji icons; reuse SVG only if a section chevron is needed.
- Empty rail: **hide the section entirely** (no “0 actresses” dead end). Videos keep their own empty state.

### Search page structure

```
┌─────────────────────────────────────────────┐
│  Search: {q}                     N+ videos  │
├─────────────────────────────────────────────┤
│  女优 / Actresses              (only if >0) │
│  (→) [avatar] [avatar] [avatar] …  scroll   │
├─────────────────────────────────────────────┤
│  VideoFilterBar (filters + sort)            │
│  VideoGrid + InfiniteSentinel               │
└─────────────────────────────────────────────┘
```

### Rail behavior

- Horizontal scroll on overflow; no page-level horizontal scroll (rail is contained: `overflow-x: auto`, `overscroll-x: contain`, hide scrollbar or thin scrollbar matching theme).
- Max **12** actresses in the rail (API `limit`, default 8–12).
- Order: better fuzzy score first (exact > prefix > substring; then higher `videoCount` as tie-break when available).
- Click → `/actress/${encodeURIComponent(slug)}` (same as `ActressCard` today).
- Loading: compact skeleton row of 4–6 circular placeholders (reuse / extend `ActressSkeleton` patterns if present).
- Error on actress API: silent empty rail (do not fail the whole search page).

### Detail page

No change required for filters/sort — `ActressDetailPage` already has `VideoFilterBar` + paged works. This feature’s “support filter and sort” is satisfied by:

1. Search page → video filters/sort.
2. Actress profile → works filters/sort after navigation.

---

## 5. API design

### `GET /api/actresses/search`

**Query**

| Param | Type | Notes |
|-------|------|--------|
| `q` | string | required, trimmed; min length 1 |
| `locale` | `zh` \| `en` | same as other routes |
| `limit` | number | default `12`, max `24` |

**Response 200**

```json
{
  "query": "三上",
  "items": [
    {
      "slug": "yua-mikami",
      "name": "三上悠亜",
      "avatarUrl": "https://fourhoi.com/actress/12345-t.jpg",
      "actressId": "12345",
      "videoCount": 320,
      "debutYear": 2015,
      "rank": null
    }
  ],
  "count": 1,
  "source": "scrape",
  "matchedBy": "fuzzy"
}
```

**Errors**

- `400` if `q` missing/empty.
- `503` only if upstream hard-fails **and** no cache; prefer returning `{ items: [] }` when scrape yields nothing.

**Cache**

- Key: `actresses:search:v1:${locale}:${normalizedQ}:${limit}`
- TTL: same as browse/search actress list TTL (`config.ttl.browse` or search — prefer browse-like).

### Python / bridge

Extend `server/py/scrape_actresses.py` + `pybridge.js`:

1. **Primary:** attempt MissAV actress search URL patterns if available, e.g. localized paths that accept keyword query (probe candidates similar to `candidate_urls`, including `search`/`keyword` query params if the site supports them). Parse with existing `parse_actress_cards`.
2. **Fallback:** scrape first **N pages** of actress list (default N=2–3, sort by videos) and **fuzzy-filter** in Python/Node by normalized name/slug.
3. Normalization for match:
   - lowercase
   - strip spaces / full-width spaces / common separators (`·`, `・`, `-`, `_`)
   - treat query as substring of `name` or `slug` (slug with hyphens stripped)
4. CLI mode: `search q locale limit` (or equivalent argv).
5. `pyScrapeActressesSearch({ q, locale, limit })` in `pybridge.js`.

Route registration order: **`/api/actresses/search` must be registered before `/api/actresses/:slug`** so `"search"` is not captured as a slug.

### Client API (`src/lib/api.ts`)

```ts
actressSearch: (q: string, locale: Locale, limit = 12) =>
  getJson<{ query: string; items: ActressSummary[]; count: number }>(
    `/api/actresses/search?q=...&locale=...&limit=...`,
    locale,
  )
```

Types: reuse `ActressSummary`; no new required fields.

---

## 6. Frontend changes

### `SearchPage.tsx`

- Keep existing video loader / `usePagedList` / `VideoFilterBar` unchanged in behavior.
- On `q` / `locale` change:
  - Fire `api.actressSearch(q, locale)` once (not on video filter changes).
  - Store `actresses`, `actressesLoading`, ignore throw → `[]`.
- Render `ActressSearchRail` above `VideoFilterBar` when `actresses.length > 0` or while loading (skeleton).
- i18n keys:
  - `actressMatches` / zh: `相关女优` en: `Actresses`
  - optional `viewAllActresses` not required this iteration.

### New component `ActressSearchRail` (or `src/components/ActressRail.tsx`)

- Props: `{ items: ActressSummary[]; loading?: boolean; title: string }`
- Uses `ActressCard` inside a horizontal flex track.
- CSS class: `.actress-rail` / `.actress-rail-track` in `src/index.css`.
- Stagger index for animation continuity.

### CSS

- Horizontal rail: `display: flex; gap; overflow-x: auto; scroll-snap-type: x proximity;`
- Cards: `flex: 0 0 auto; scroll-snap-align: start;`
- Slightly smaller avatar optional (e.g. 80–88px) on rail only via modifier class — keep readable name clamp.
- Skeleton circles matching avatar size.

### Layout / header search

- No change to submit flow (`/search?q=`).
- Placeholder already says 女优 — keep.

---

## 7. Data flow

```
User submits q
    → navigate /search?q=
SearchPage
    ├─ api.actressSearch(q)  ──→  /api/actresses/search  ──→ py scrape/fuzzy  ──→ ActressRail
    └─ api.searchPage(q, filters, sort) ──→ /api/search  ──→ VideoGrid
Click actress card
    → /actress/:slug  (existing detail + VideoFilterBar)
```

---

## 8. Edge cases

| Case | Behavior |
|------|----------|
| `q` is product code only (e.g. `SSIS-001`) | Actress API returns []; rail hidden; videos as today |
| Many fuzzy hits | Cap at `limit`; no “load more” in rail |
| Actress API slow | Show skeleton briefly; videos independent |
| Actress API fails | Rail empty; videos unaffected |
| No videos but actress hits | Show rail + video empty state |
| Duplicate slugs | Dedupe by slug server-side |
| CJK + romaji mixed | Match either name or slug after normalize |

---

## 9. Testing / acceptance

1. Search a known partial name (e.g. substring of a listed actress) → rail shows avatar + name; click opens profile with works.
2. Search nonsense → no rail; video empty or unrelated scrape behavior unchanged.
3. Apply video filter/sort on search page → rail **does not** reload; video list does.
4. Profile page filter/sort still works.
5. Responsive: rail scrolls horizontally on 375px; no body horizontal scroll.
6. Keyboard: cards are links, focus-visible ring present.
7. `npm run lint` / `tsc -b` clean for touched files.

---

## 10. File touch list (implementation)

| Area | Files |
|------|--------|
| Scrape | `server/py/scrape_actresses.py` |
| Bridge | `server/pybridge.js` |
| Route | `server/index.js` (`/api/actresses/search` before `:slug`) |
| Types / API | `src/types.ts` (if needed), `src/lib/api.ts` |
| UI | `src/pages/SearchPage.tsx`, new `src/components/ActressRail.tsx` (name flexible), `src/components/Skeleton.tsx` (optional), `src/index.css`, `src/i18n.ts` |
| Design ref | `design-system/aether-search/*` (already generated) |

---

## 11. Out of scope / later

- Header typeahead suggestions.
- “See all matching actresses” page with full actress filters.
- Merging recombee person entities.
- Persisting rail scroll position.

---

## 12. Spec self-review

- No TBD placeholders left for MVP behavior.
- Layout, match rule, filter scope, and data source are consistent with §2.
- Scope is one feature (search rail + API); detail page reuse avoids scope creep.
- Ambiguity resolved: filters on search page = videos only; actress filters live on detail/list pages.
)
