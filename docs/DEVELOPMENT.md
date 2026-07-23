# AETHER 开发文档

面向在本仓库改功能、修 bug、部署的开发者。产品级契约与上游探测细节见兄弟目录：

| 文档 | 位置 | 内容 |
|------|------|------|
| API 契约 / 上游 | `../docs/api-contract.md` | Recombee 签名、DTO、拓扑 |
| 决策记录 | `../docs/DECISIONS.md`、`../docs/adr/` | 架构取舍 |
| 术语 | `../docs/glossary.md` | 名词表 |
| 设计系统 | `design-system/aether/` | Soft Cinema Dark UI |
| AI 助手索引 | `CLAUDE.md` | 给 Claude Code 的精简地图 |
| 运维速查 | `README.md` | 启动 / Docker / Env |
| **优化实现** | [`OPTIMIZATION.md`](./OPTIMIZATION.md) | 待做性能/安全/结构改造的分期、步骤、验收 |

---

## 1. 项目是什么

**AETHER** = 杂志编辑风格的 React SPA + Node 同源代理。

- 元数据：Recombee 公开签名 API + MissAV HTML 抓取（Python `curl_cffi`）
- 播放：surrit HLS，经 `/api/hls` 代理（补 missav Referer）
- 封面：浏览器直连 `fourhoi.com`（不经 API）
- **浏览器不直接请求** MissAV / Recombee 的 catalog API

```
Browser (React 19 + Vite :5173)
  credentials:include → same-origin /api/*
        │
        ▼
Node Express (server/index.js :8787)
  ├─ requireAuth（除 health / auth）
  ├─ 磁盘缓存 + singleflight + SWR
  ├─ Recombee 签名请求
  ├─ pybridge → server/py/*.py（列表 / 女优 / 目录 / 解析流）
  ├─ mediaWorker → media_server.py :18790（HLS 上游拉取）
  └─ hlsProxy → GET /api/hls?url=
       仅 allowlist: surrit / fourhoi / missav.*
```

---

## 2. 环境要求

| 依赖 | 版本 / 说明 |
|------|-------------|
| Node.js | 20+（Docker 用 20 bookworm） |
| npm | 随 Node |
| Python | 3.10+，命令名 `python`（Windows / Docker 已 `ln` 到 python3） |
| pip 包 | `curl_cffi`（抓取 + 流解析 + media worker **必需**） |

```bash
# 一次性
npm install
pip install curl_cffi
```

可选：复制环境变量

```bash
cp .env.example .env
# 本地开发可留空 SITE_PASSWORD（站点开放）
# 公网务必设置 SITE_PASSWORD + AUTH_SECRET
```

---

## 3. 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 同时起 API `:8787` + Vite `:5173` |
| `npm run dev:server` | 仅 API |
| `npm run dev:web` | 仅前端（`/api` 代理到 `127.0.0.1:8787`） |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm start` | 生产形态：API 托管 `dist/` + SPA fallback |
| `npm run lint` | `oxlint` |
| `npm test` | `node:test` 核心纯函数（auth / cache / filters / m3u8 / scrapeMap） |
| `npm run preview` | 预览已构建静态资源 |

改完后至少：

1. `npm test` + `npm run build`（类型 + 打包）
2. `npm run dev` 点一遍相关页面
3. 需要时看响应头 `X-Aether-Cache: fresh|stale|miss|coalesced` 与 `GET /api/health` 的 worker 字段

### Docker

```bash
cp .env.example .env   # 填 SITE_PASSWORD / AUTH_SECRET
docker compose up -d --build
# 宿主机 nginx 示例：deploy/nginx-ljl.050415.xyz.conf
# 更新：deploy/update.sh 或 git pull + compose up -d --build
```

- 容器映射：`127.0.0.1:8787:8787`
- 卷：`aether-cache` → `/app/.cache/aether`
- 健康检查：`GET /api/health`

---

## 4. 仓库结构

```
aether/
├── src/                    # React 前端
│   ├── main.tsx / App.tsx / types.ts / i18n.ts / context.tsx
│   ├── index.css           # @import 聚合（OPT-13）
│   ├── styles/             # tokens / base / layout / components / pages
│   ├── lib/api.ts          # API 客户端（支持 AbortSignal）
│   ├── lib/listCache.ts    # 列表内存缓存 + in-flight 去重
│   ├── hooks/usePagedList.ts  # deps 变化时 abort 上次请求
│   ├── components/ / pages/ / nav/
├── server/
│   ├── index.js            # listen / warm / workers / shutdown
│   ├── app.js              # express 组装 + middleware + mount routes
│   ├── config.js           # 端口 / 缓存 / TTL / 鉴权 / feature flags
│   ├── auth.js / cache.js / recombee.js / map.js / categories.js
│   ├── videoFilters.js / stream.js / pybridge.js / hlsProxy.js
│   ├── mediaWorker.js      # media_server :18790（含 /fetch_stream）
│   ├── scrapeWorker.js     # scrape_server :18791
│   ├── routes/             # home / catalog / video / actresses / health
│   ├── services/           # cacheWrap / scrapeMap / videoBundle / warm / metrics
│   ├── middleware/         # security / rateLimit
│   ├── util/               # locale / sendError
│   └── py/
│       ├── scrape_list.py / scrape_actresses.py / scrape_catalog.py
│       ├── resolve_stream.py / scrape_server.py
│       ├── media_server.py / fetch_media.py
├── design-system/ / deploy/ / docs/
├── Dockerfile / docker-compose.yml / vite.config.ts / package.json
```

**测试：** `npm test`（`node:test`，无网络纯函数）。  
**优化清单与开关：** [`OPTIMIZATION.md`](./OPTIMIZATION.md)。

---

## 5. 本地开发工作流

### 5.1 日常

```bash
npm run dev
# Web  http://localhost:5173
# API  http://localhost:8787
```

Vite 把 `/api` 代理到 Express。前端 `fetch('/api/...')` **必须** `credentials: 'include'`（已在 `src/lib/api.ts` 统一）。

### 5.2 只改前端

可只跑 `npm run dev:web`，但需另开终端 `npm run dev:server`，否则接口全挂。

### 5.3 只改后端 / Python

```bash
npm run dev:server
# 或 curl 直打 :8787
curl -s http://127.0.0.1:8787/api/health
```

改 `server/py/*.py` 后：

- **scrape_server / media_server 长驻进程**：需重启 Node（会杀子进程）或手动杀 `SCRAPE_PORT` / `MEDIA_PORT` 上的 Python
- **one-shot fallback 脚本**：下次 spawn 即加载新代码

### 5.4 Windows 注意

- `pybridge` 设了 `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`，避免 CJK JSON 在 GBK 控制台下损坏
- 端口占用：`netstat -ano | findstr :8787` → `taskkill /PID <pid> /F`
- 缓存文件名为 `sha256(key)`，CJK key 不再靠明文文件名（OPT-02）

### 5.5 缓存目录

默认：`./.cache/aether/`（gitignored）。L1 在内存；磁盘 JSON 原子写 + 定时 GC。调试脏数据可整目录删除。

---

## 6. 前端约定

### 6.1 路由（`src/App.tsx`）

| 路径 | 页面 |
|------|------|
| `/` | HomePage |
| `/browse` | BrowsePage |
| `/search` | SearchPage |
| `/actresses`、`/actresses/ranking` | ActressesPage |
| `/actress/:slug` | ActressDetailPage |
| `/genres`、`/makers` | CategoryIndexPage |
| `/categories`、`/c/:slug`、`/c/:kind/:name` | CategoriesPage |
| `/v/:id` | WatchPage |

外壳：`LocaleProvider` → `AuthShell` → `BrowserRouter` → `Layout`。

### 6.2 API 客户端

- 唯一入口：`src/lib/api.ts`（`FetchOpts.signal` 支持 Abort）
- 类型：`src/types.ts`（`VideoDetail.streamStatus` 可选）
- 列表：优先 `listCacheLoad` / `categoryListCacheKey`（hover 预取与首屏共用）
- 无限滚动：`hooks/usePagedList.ts`  
  - **以服务端 `hasMore` 为准**  
  - scrape 一页约 12 条，不是客户端 `pageSize` 24  
  - deps 变化时 abort 上一次请求（OPT-08）
- 观看页：先拉 meta，无 `stream.masterUrl` 时自动 `resolve-stream`（OPT-07）

### 6.3 播放器

- `components/Player.tsx`：hls.js
- 流地址必须是**同源相对路径** `/api/hls?url=...`  
  绝对地址 `http://host:8787/...` 在 Vite 开发下会丢 session cookie → `manifestLoadError`
- 画质偏好：`localStorage` key `aether.hlsQuality`

### 6.4 i18n

- `zh` / `en`：`i18n.ts` + `context.tsx`
- 持久化：`localStorage` → `aether.locale`
- 请求头：`X-Locale`（服务端也认 `?locale=`）

### 6.5 UI

- 遵循 `design-system/aether/MASTER.md`（Soft Cinema Dark）
- 样式集中在 `src/index.css`；页面级备注可看 `design-system/aether/pages/`

### 6.6 新增列表类页面检查清单

1. 在 `api.ts` 增加方法（`credentials` + `X-Locale`）
2. `types.ts` 补类型
3. 页面用 `usePagedList` 或现有 pager
4. 错误态 / skeleton / 空态与现有页一致
5. 需要侧栏入口 → `nav/navConfig.ts` **且**（若是分类）`server/categories.js`

---

## 7. 后端约定

### 7.1 配置（`server/config.js`）

| 变量 | 默认 / 含义 |
|------|-------------|
| `PORT` | `8787` |
| `CACHE_DIR` | `./.cache/aether` |
| `SITE_PASSWORD` | 空 = 开放；有值 = 全站 API 门禁 |
| `AUTH_SECRET` | 会话 HMAC 密钥（生产强烈建议） |
| `AUTH_TTL_HOURS` | `168` |
| `AUTH_SECURE_COOKIE` | 生产 / `1` 时 Secure |
| `RECOMBEE_*` | host / db / public token |
| `MISS_DETAIL_BASES` | 详情站镜像列表 |
| `MISS_LANG` | 详情语言路径 |
| `MEDIA_PORT` | media worker，默认 `18790` |

TTL（毫秒）在 `config.ttl`：`home` / `search` / `browse` / `video` / `stream` / `categories` / `negative`。

### 7.2 鉴权（`server/auth.js`）

- 密码只在服务端；前端只有门禁 UI
- 会话：HMAC-SHA256 签名 payload → HttpOnly cookie `aether_session`
- 登录：每 IP 6 次 / 15 分钟，超限锁 15 分钟
- 公开路径：`/api/health`、`/api/auth/*`；其余 `/api/*` 在门禁开启时需会话
- SPA 静态资源**不**锁，以便渲染 `AccessGate`

### 7.3 缓存（`withCache` in `index.js` + `cache.js`）

| 情况 | 行为 | `X-Aether-Cache` |
|------|------|------------------|
| 未过期 | 直接返回 | `fresh` |
| 过期但有值 | 立即返回旧值 + 后台刷新 | `stale` |
| 冷未命中 | singleflight 一个 loader | `miss` / `coalesced` |
| loader 失败 | 尽量返回 last-success | `stale` |

缓存 key 带版本前缀（如 `cat:v11:…`、`search:v7:…`）。**改响应 shape 或核心逻辑时务必 bump 版本**，否则用户会吃到旧 JSON。

### 7.4 抓取与分页

- MissAV 列表 HTML 大约 **12 张卡 / 页**
- `SCRAPE_PAGE_FULL = 8`：本页有效条数 ≥ 8 才认为 `hasMore`
- **不要**用客户端 `pageSize`（24）判断是否还有下一页
- `isLikelyVideoId` 过滤页脚 / 导航假 slug
- 列表常缺女优名：`enrichSummariesFromRecombee` 用 search + `itemId` OR 补齐（public token **不能** `GET /items/{id}`）

### 7.5 Python 桥（`pybridge.js`）

| 函数 | 脚本 |
|------|------|
| `pyScrapeList` | `scrape_list.py` |
| `pyScrapeActresses*` | `scrape_actresses.py` |
| `pyScrapeCatalog` | `scrape_catalog.py` |
| `pyResolveStream` | `resolve_stream.py` |

约定：脚本 stdout 打印 **一行 JSON**；`ok: false` 或非 0 退出由 Node 转成错误。超时默认约 45–60s。

Media：**长驻** `media_server.py`，失败才 `fetch_media.py` one-shot。

### 7.6 HLS 代理

1. 校验 `url` host ∈ allowlist  
2. 经 media worker 拉上游  
3. m3u8：改写所有分片 / URI 为相对 `/api/hls?url=`  
4. 禁止嵌套 `/api/hls`

`toProxiedStream` 保证返回给浏览器的永远是相对路径。

### 7.7 启动预热

`warmPopularCategories()`：启动约 3s 后错峰抓热门 slug，填满磁盘缓存。失败只打 log，不阻塞 listen。

### 7.8 新增 / 修改 API 检查清单

1. 路由写在 `server/index.js`（或拆出后挂到同一 app）
2. 需要缓存 → `withCache` + **版本化 key** + 合适 TTL
3. 错误统一：`sendError(res, status, code, error, details?)`  
   常见 code：`UPSTREAM`、`NOT_FOUND`、`CONFIG`、`AUTH_REQUIRED`、`RATE_LIMITED`
4. 前端 `api.ts` + `types.ts` 同步
5. 分类导航：`categories.js` + `navConfig.ts` 双写
6. 抓取逻辑只放 Python + `curl_cffi`，**不要**用裸 Node `fetch` 打 MissAV HTML（易 403）

---

## 8. 浏览器可见 API 一览

```
GET  /api/health
GET  /api/auth/status
POST /api/auth/login
POST /api/auth/logout
GET  /api/hls?url=

GET  /api/home
GET  /api/home/more
GET  /api/video-filters
GET  /api/search?q=&page=&pageSize=&filters=&sort=
GET  /api/browse?page=&…
GET  /api/categories
GET  /api/genres?page=
GET  /api/makers?page=
GET  /api/c/:slug
GET  /api/c/:kind/:name
GET  /api/video/:id
POST /api/video/:id/resolve-stream
GET  /api/video/:id/related
GET  /api/actresses
GET  /api/actresses/filters
GET  /api/actresses/ranking
GET  /api/actresses/search?q=
GET  /api/actresses/:slug
```

错误体：

```json
{ "error": "string", "code": "UPSTREAM|NOT_FOUND|…", "details": "optional" }
```

完整字段级契约以 `../docs/api-contract.md` 与 `src/types.ts` 为准；二者冲突时以**当前代码**为准并应回写文档。

---

## 9. 关键数据流

### 9.1 首页

1. `GET /api/home` → Recombee `desktop-home-recommended`（hero + featured），`morePending: true`
2. 客户端再 `GET /api/home/more` → segments + 中字 rail + scrape `new`

### 9.2 分类列表 `/c/...`

1. `resolveCategory` / `findCategory`
2. 优先 `pyScrapeList(listPath)`
3. 失败则 genre scenario / Recombee filter
4. `mapScrapeItemsEnriched` → 缓存 `cat:v11:…`

### 9.3 观看页

1. `GET /api/video/:id`：Recombee 搜 meta + related + resolve stream（可缓存）
2. 响应里 `stream.masterUrl` 已是 `/api/hls?url=…`
3. 失败可 `POST …/resolve-stream` 强制重解析，或手动贴 UUID/m3u8（前端仍走代理）

### 9.4 女优详情

1. `scrape_actresses.py` detail 模式（profile + 作品页）
2. 空列表时回退 `scrape_list` `actresses/{slug}`
3. 分页用 scrape 的 `hasMore` / `maxPage`，**不要**用去重后条数 < 12 误判结束
4. 翻页时保留 hero `avatarUrl`（后续页 HTML 可能没有头像）

---

## 10. 调试技巧

| 现象 | 排查 |
|------|------|
| 列表只有一页 | 看响应 `hasMore`、是否误用 pageSize；抓取是否被当 junk 滤光 |
| 开发环境无法播放 | 流是否绝对 URL 指向 `:8787`；是否未登录导致 HLS 401 |
| 全站 401 | `SITE_PASSWORD` 已开；先 `/api/auth/login`；cookie 是否 SameSite/Secure 不匹配 |
| scrape 全失败 | `pip show curl_cffi`；Python 是否叫 `python`；看 Node 日志 / py stderr |
| 女优搜索结果串了 | 旧缓存 key 把 CJK 抹成 `_`；清 `.cache/aether` 并确认 `cache.js` 保留 Unicode |
| Recombee 空 | token / 签名 / filter 语法；对比 `recombee.js` 与 api-contract |
| Docker 无流 | 容器内 media worker 日志；`MEDIA_PORT` 未被占；`curl_cffi` 是否装上 |
| 缓存「改代码不生效」 | key 版本未 bump；或 SWR 一直返回 stale |

有用的响应头：

- `X-Aether-Cache`
- 登录限流：`Retry-After`

---

## 11. 部署要点

1. 宿主机 nginx 终止 TLS，反代到 `127.0.0.1:8787`
2. 设置真实的 `SITE_PASSWORD`、`AUTH_SECRET`、`AUTH_SECURE_COOKIE=1`
3. `/api/hls` 建议 `proxy_buffering off`、更长 `proxy_read_timeout`（见 `deploy/nginx-*.conf`）
4. `.env` **不要**提交；`SITE_PASSWORD` **不要**写进前端
5. 更新：`git pull` + `docker compose up -d --build`（缓存 volume 保留）

---

## 12. 编码风格与边界

- 扩展现有路由 / DTO / `api.ts`，避免平行再写一套 client
- 新导航条目：后端 categories + 前端 navConfig **同时改**
- 上游 HTML / TLS：Python；Node 只编排
- HLS：只走 `/api/hls`，player 只用相对路径
- Lint：`oxlint`；TS 工程引用：`tsconfig.json` → app / node
- 不引入未约定的大依赖；UI 不另起配色体系

---

## 13. 已知技术债 / 优化方向（择要）

完整实现说明、分期、验收与状态板见 **[`OPTIMIZATION.md`](./OPTIMIZATION.md)**。摘要：

1. **OPT-01** Scrape 长驻 worker（对齐 media_server）  
2. **OPT-03** HLS 流式转发  
3. **OPT-02** 磁盘缓存 L1 + 原子写 + GC  
4. **OPT-06** 拆分 `server/index.js`  
5. **OPT-04** trust proxy + CORS 白名单 + API 限流  
6. **OPT-14** Recombee 分页策略  
7. **OPT-08 / 09** 前端 AbortController、长列表性能  
8. **OPT-11** 最小单测  
9. **OPT-07 / 13** video meta·stream 分离、`index.css` 拆分  

---

## 14. 功能设计稿索引

历史 / 进行中的设计与计划（非完整规格）：

- `docs/superpowers/specs/`
- `docs/superpowers/plans/`

新开大功能时建议：先短 design 笔记 → 再改代码 → 必要时 bump 缓存 key 与 api-contract。

---

## 15. 快速自检清单（PR 前）

- [ ] `npm run build` 通过  
- [ ] `npm run lint` 无新增问题  
- [ ] 若改缓存逻辑 / 响应 shape：相关 key 已 bump  
- [ ] 若改分类：categories + navConfig  
- [ ] 若改播放路径：开发态 Vite + 生产 `npm start` 都能播  
- [ ] 若改鉴权：开/关门禁两种模式都试  
- [ ] 未把密钥写进前端或提交 `.env`  
- [ ] 抓取相关：本机 `curl_cffi` 可用  

---

*文档版本：与仓库 `main` 同步整理（2026-07-23）。代码变更后请顺手改本节过时处。*
