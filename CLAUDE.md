# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**AETHER** — magazine-editorial React SPA + Node proxy for MissAV-class metadata (Recombee + HTML scrape), surrit HLS playback, and Huangguo AI short dramas. Catalog APIs stay same-origin; MissAV covers load from `fourhoi.com`, while Huangguo covers and all stream media use the proxy.

Sibling product docs (parent of this repo): `../docs/api-contract.md`, `../docs/DECISIONS.md`, `../docs/adr/`.

**Developer handbook (this repo):** [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — local workflow, structure, API map, cache/auth/scrape conventions, debug table, PR checklist.

**Optimization backlog:** [`docs/OPTIMIZATION.md`](./docs/OPTIMIZATION.md) — OPT-01…15 (scrape worker, HLS streaming, cache L1, security, split server, tests, …) with acceptance criteria.

## Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install Node deps |
| `pip install curl_cffi` | Required for scrape + stream resolve + media worker |
| `npm run dev` | Vite (`:5173`) + API (`:8787`) via concurrently |
| `npm run dev:web` | Frontend only (proxies `/api` → `127.0.0.1:8787`) |
| `npm run dev:server` | API only |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm start` | Production-like: API serves `dist/` + SPA fallback |
| `npm run lint` | `oxlint` (React + TS plugins; `.oxlintrc.json`) |
| `npm test` | `node:test` pure functions, HTTP/auth/drama contracts, pager and player checks |
| `npm run test:python` | Offline Python parser/media/Huangguo checks |
| `npm run preview` | Vite preview of built assets |

Validate: `npm test` + `npm run build` + `npm run dev` smoke. See `docs/OPTIMIZATION.md` for feature flags (`SCRAPE_WORKER`, `HLS_STREAMING`, `VIDEO_LAZY_STREAM`, `RATE_LIMIT`).

### Docker / VPS

```bash
cp .env.example .env   # set SITE_PASSWORD / AUTH_SECRET
docker compose up -d --build
# optional: deploy/nginx-ljl.050415.xyz.conf → host nginx
# update: deploy/update.sh (on VPS) or git pull + docker compose up -d --build
```

- Container binds `127.0.0.1:8787`; nginx terminates TLS in front.
- Volume `aether-cache` → `/app/.cache/aether`.
- Healthcheck: `GET /api/health`.

### Env (see `.env.example` and README)

| Var | Notes |
|-----|--------|
| `PORT` | Default `8787` |
| `CACHE_DIR` | Default `./.cache/aether` |
| `SITE_PASSWORD` | Empty = open site; set = full gate |
| `AUTH_SECRET` | HMAC key for session cookies (recommended prod) |
| `AUTH_TTL_HOURS` | Default 168 |
| `AUTH_SECURE_COOKIE` | `1` / prod default Secure flag |
| `RECOMBEE_PUBLIC_TOKEN` / host / db | Optional overrides; defaults in `server/config.js` |
| `MISS_DETAIL_BASES`, `MISS_LANG` | Detail scrape bases / lang |
| `MEDIA_PORT` | Python media worker (default `18790`) |

## Architecture

```
Browser (React 19 + Vite + react-router + hls.js)
  │  credentials:include → same-origin /api/*
  ▼
Node Express (server/index.js → app.js :8787)
  ├─ trust proxy + security headers + tiered rate limit + requireAuth
  ├─ L1+disk cache + singleflight + SWR (cache.js / services/cacheWrap.js)
  ├─ Recombee signed public API (recombee.js → map.js DTOs)
  ├─ pybridge → scrapeWorker RPC (scrape_server.py :18791) → spawn fallback
  ├─ mediaWorker → media_server.py :18790 (/fetch + /fetch_stream)
  └─ HLS proxy (hlsProxy.js) playlist rewrite + segment stream
       allowlisted hosts: surrit / fourhoi / missav.* + exact Huangguo media CDNs
```

### Frontend (`src/`)

- **Entry:** `main.tsx` → `App.tsx` (`LocaleProvider` → `AuthShell` → `BrowserRouter` → `Layout`).
- **Auth UX:** `AuthShell` boots on `/api/auth/status`; locked → `AccessGate`. Unlock only after server sets HttpOnly cookie — client state alone cannot open APIs.
- **API client:** `src/lib/api.ts` — all fetches use `credentials: 'include'` and `X-Locale`. Category lists use `listCache.ts` (memory + in-flight dedupe) including hover prefetch.
- **Video list pagination:** `hooks/usePagedList.ts` replaces items for the URL page; `hooks/usePageQuery.ts` preserves filters and navigation state in browser history. Browse/search/category/actress works and topic details use `PagePager`, with no automatic loading of later pages. Filter/sort changes reset page 1. `hasMore` prefers the server flag (scrape pages are ~12 items, not client `pageSize` 24); do not invent a total when the source omits it. Topic fragment pages can omit their header, so direct page URLs fetch page 1 metadata separately.
- **Routes:** home, browse, search, actresses (+ ranking), `actress/:slug`, genres/makers index, `c/:slug` and `c/:kind/:name`, watch `v/:id`, AI dramas `dramas` and `dramas/:id?episode=ep-N`. Nav tree: `src/nav/navConfig.ts`.
- **AI dramas:** `pages/DramasPage.tsx` uses manual 24-item pagination and exact episode selection. Huangguo `ai-duanju` only, no alternate providers/accounts/downloads; unavailable episodes never fall back to previews or neighbors. Covers use `/api/dramas/:id/cover`.
- **Player:** `components/Player.tsx` — `format='hls'` (default) uses hls.js/native HLS; `format='mp4'` uses native video. Stream URLs must stay **same-origin** `/api/hls?...` so the session cookie is sent (absolute `http://host:8787/...` breaks dev playback). Quality preference in `localStorage` (`aether.hlsQuality`).
- **i18n:** `context.tsx` + `i18n.ts` (`zh` / `en`); locale in `localStorage` key `aether.locale`.
- **Types:** `src/types.ts` is the frontend DTO contract (aligned with `../docs/api-contract.md`).
- **Styling:** `src/index.css` aggregates `src/styles/`; `src/styles/tokens.css` defines the Morandi Editorial paper-and-sage palette. Theatre/fullscreen players use dark cinema surfaces. Search design notes: `design-system/aether-search/`.

### Backend (`server/`)

| Module | Role |
|--------|------|
| `index.js` | listen, warm workers, warm categories, shutdown |
| `app.js` | express + middleware + mount `routes/*` + static SPA |
| `routes/*` | home, catalog, video, actresses, whos, subtitles, dramas, health/admin stats |
| `services/*` | cacheWrap, scrapeMap (+ enrich cache), videoBundle, warm, metrics, homeRails, subtitles, dramas |
| `middleware/*` | security headers, CORS, tiered rate limit |
| `config.js` | Port, cache L1/GC, Recombee, Miss bases, auth, feature flags |
| `auth.js` | HMAC session cookie, timing-safe password, per-IP login rate limit |
| `cache.js` | L1 LRU + hashed disk files + atomic write + GC |
| `recombee.js` / `map.js` / `categories.js` / `videoFilters.js` | as before |
| `stream.js` / `pybridge.js` | resolve + RPC-first scrape bridge |
| `hlsProxy.js` / `mediaWorker.js` / `scrapeWorker.js` | media + scrape long-running workers |

**Python scripts (`server/py/`):**

- `scrape_list.py` / `scrape_actresses.py` / `scrape_catalog.py` / `scrape_whos.py` / `resolve_stream.py` / `subtitles.py` — CLI + importable by worker
- `huangguo.py` — Huangguo catalog/detail/exact-episode adapter + validated source transport
- `scrape_server.py` — long-lived scrape RPC `:18791`
- `media_server.py` — long-lived `/fetch` + `/fetch_stream` `:18790`
- `fetch_media.py` — one-shot media fallback

### Important server behaviors

- **Cache:** fresh hit → return; stale → return immediately + background revalidate (SWR); cold miss → singleflight; loader failure → last-success stale when allowed. Keys are versioned strings (e.g. `cat:v11:…`) — bump when response shape/logic changes.
- **Scrape `hasMore`:** list HTML is ~12 cards/page; server uses scrape fullness (`SCRAPE_PAGE_FULL`), not client pageSize, to decide whether the next page is available.
- **Junk slug filter:** `isLikelyVideoId` drops footer/nav false positives (partners, ranking, login, etc.).
- **Enrichment:** scrape often lacks actresses/duration; `enrichSummariesFromRecombee` fills via public search + `itemId` OR filter (public token cannot `GET /items/{id}`).
- **Auth public paths:** `/api/health`, `/api/auth/*` only; everything else needs session when `SITE_PASSWORD` is set.
- **Huangguo:** `routes/dramas.js` → `services/dramas.js` → `py/huangguo.py` via scrape RPC/spawn. Only `ai-duanju`; exact HTTPS hosts `huangguoai.com`, `pic.wirqed.cn`, `yd-hls.tktjpm.cn`, `tp3.wirqed.cn`. Validate every redirect and pin public IPs; bypass environment proxies on source requests. A bounded fixed AliDNS HTTPS fallback handles failed/private/Fake-IP system DNS. Never widen allowlists or bypass validation for CDN changes. Resolve is uncached; cover decoding is bounded and raster-only.
- **Boot warm:** `warmPopularCategories()` staggers scrape of hot slugs to prime disk cache.

### API surface (browser-facing)

```
GET  /api/health
GET|POST /api/auth/status|login|logout
GET  /api/hls?url=
GET  /api/home  |  /api/home/more
GET  /api/video-filters
GET  /api/search  /api/browse  /api/categories
GET  /api/genres  /api/makers
GET  /api/c/:slug  |  /api/c/:kind/:name
GET  /api/video/:id  |  /related
POST /api/video/:id/resolve-stream
GET  /api/video/:id/subtitles?durationSec=   # external zh subs when hasChineseSubtitle=false
GET  /api/subtitle?url=                       # same-origin WebVTT (host allowlist)
GET  /api/actresses  /filters  /ranking  /search  /:slug
GET  /api/dramas?page=  |  /api/dramas/:id  |  /api/dramas/:id/cover
POST /api/dramas/:id/episodes/:episode/resolve
GET  /api/whos/frames[/categories|/:id]  /topics[/:id]  /ranking
```

Errors: `{ error, code, details? }` (`UPSTREAM`, `NOT_FOUND`, …). Cache mode often on `X-Aether-Cache`.

## Conventions when changing code

- Prefer extending existing routes in `server/index.js` and DTOs in `src/types.ts` / `src/lib/api.ts` rather than new parallel clients.
- New catalog nav entries: wire both `server/categories.js` and `src/nav/navConfig.ts`.
- Scraping/TLS work stays in Python + `curl_cffi`; do not reintroduce naive Node fetch for MissAV HTML (403).
- HLS playback must go through `/api/hls` with same-origin URLs in the player.
- Never put `SITE_PASSWORD` or session secrets in frontend code or commits; `.env` is gitignored.
- Design/UI: reuse `src/styles/tokens.css` and existing component/page styles rather than inventing a new palette.
- Lint with oxlint; TypeScript project references via root `tsconfig.json` → `tsconfig.app.json` / `tsconfig.node.json`.
