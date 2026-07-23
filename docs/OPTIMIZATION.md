# AETHER 优化实现文档

本文档把「已知技术债 / 优化方向」拆成**可排期、可验收、可回滚**的实现任务。  
配套阅读：[`DEVELOPMENT.md`](./DEVELOPMENT.md)（现状与约定）、`../docs/api-contract.md`（契约）。

| 元数据 | |
|--------|--|
| 状态 | **已实施**（OPT-01…15） |
| 基准代码 | `main` @ 2026-07-23 |
| 目标环境 | 单 VPS Docker + 本机 `npm run dev` |
| 原则 | 小步合并；行为兼容优先；缓存 key 变更必须 bump 版本 |

---

## 0. 总览

### 0.1 目标

| 维度 | 当前痛点 | 优化后期望 |
|------|----------|------------|
| 列表首屏 | 每次 scrape `spawn` Python，冷启动慢 | 长驻 worker + 队列，热路径 < 上游 RTT |
| 播放内存 | HLS 分段整段进 Node/Python 内存 | segment 流式 pipe，峰值内存可控 |
| 缓存 | 纯磁盘 JSON，无 GC，无 L1 | L1 内存 + 原子写 + 过期清理 |
| 公网安全 | 弱 CORS / 无限流 / 限流仅内存 | trust proxy + 白名单 + 分层限流 |
| 可维护性 | `server/index.js` ~1.3k 行 | routes / services 拆分 |
| 质量 | 无测试 | 核心纯函数 + 冒烟 |

### 0.2 分期（已完成）

```text
Phase A  性能主干     OPT-01 scrape worker · OPT-02 cache L1 · OPT-03 HLS stream
Phase B  公网硬化     OPT-04 security hardening · OPT-05 health
Phase C  结构债       OPT-06 split server · OPT-07 video meta/stream split
Phase D  前端体验     OPT-08 abort · OPT-09 virtual list · OPT-10 enrich cache
Phase E  质量与观测   OPT-11 tests · OPT-12 metrics · OPT-13 css split · OPT-14/15
```

### 0.3 优先级矩阵

| ID | 标题 | 优先级 | 收益 | 风险 | 估时 |
|----|------|--------|------|------|------|
| OPT-01 | Scrape 长驻 worker | P0 | 高 | 中 | 1–2d |
| OPT-02 | 缓存 L1 + 原子写 + GC | P0 | 高 | 低 | 0.5–1d |
| OPT-03 | HLS 流式转发 | P0 | 高 | 中 | 1–2d |
| OPT-04 | 安全硬化 | P1 | 高（公网） | 低 | 0.5–1d |
| OPT-05 | Health 增强 | P1 | 中 | 低 | 0.5d |
| OPT-06 | 拆分 server/index.js | P2 | 中长期 | 中（冲突） | 1–2d |
| OPT-07 | Video meta / stream 分离 | P2 | 中 | 中 | 1d |
| OPT-08 | 前端 AbortController | P2 | 中 | 低 | 0.5d |
| OPT-09 | 列表虚拟化 / content-visibility | P2 | 中 | 低 | 0.5–1d |
| OPT-10 | Enrich 结果缓存 | P2 | 中 | 低 | 0.5d |
| OPT-11 | 最小测试套件 | P2 | 中 | 低 | 1d |
| OPT-12 | 可观测性 | P3 | 中 | 低 | 0.5–1d |
| OPT-13 | CSS 拆分 | P3 | 低 | 低 | 1d |
| OPT-14 | Recombee 分页策略 | P2 | 中 | 低 | 0.5d |
| OPT-15 | Warm 策略改进 | P3 | 低 | 低 | 0.5d |

---

## 实现摘要（2026-07-23）

| ID | 关键文件 / 行为 |
|----|----------------|
| OPT-01 | `server/py/scrape_server.py` + `server/scrapeWorker.js`；`pybridge` RPC→spawn fallback；`SCRAPE_WORKER=0` 关 |
| OPT-02 | `server/cache.js` L1 LRU + sha256 文件名 + 原子写 + 定时 GC |
| OPT-03 | `media_server` `/fetch_stream`；`mediaFetchStream` + `hlsProxy` pipeline；`HLS_STREAMING=0` 关 |
| OPT-04 | `middleware/security.js` + `rateLimit.js`；trust proxy、CORS、分层限流、生产剥离 details |
| OPT-05 | `/api/health` 含 media/scrape/cache/auth/flags |
| OPT-06 | `server/app.js` + `routes/*` + `services/*`；`index.js` 只负责 listen/warm/shutdown |
| OPT-07 | 默认 lazy stream（`VIDEO_LAZY_STREAM`）；`?stream=1` 旧行为；WatchPage 自动 `resolve-stream` |
| OPT-08 | `api.ts` `signal`；`usePagedList` / Home / Watch abort |
| OPT-09 | `.card { content-visibility: auto }` |
| OPT-10 | `enrich:v1:{id}` 缓存 + OR 分块 40 |
| OPT-11 | `npm test` → node:test 23 cases |
| OPT-12 | `services/metrics.js` + `/api/admin/stats` |
| OPT-13 | `src/styles/*` + `index.css` @import |
| OPT-14 | `RECOMBEE_MAX_COUNT`（默认 96）+ search RB fingerprint cache |
| OPT-15 | `services/warm.js` 命中计数 + 失败退避；与 scrape 并发共享 |

### 功能开关

| Env | 控制 | 默认 |
|-----|------|------|
| `SCRAPE_WORKER` | OPT-01 | on |
| `HLS_STREAMING` | OPT-03 | on |
| `RATE_LIMIT` | OPT-04 | on |
| `VIDEO_LAZY_STREAM` | OPT-07 | on |

### 缓存 key bumps

```text
search:v7 → search:v8
browse:v7 → browse:v8
cat:v11 → cat:v12
video:v2 → video:v3  (+ :m / :s)
enrich:v1:{id} 新增
```

部署后可清空 `.cache/aether`（可选；旧明文 key 文件会残留直至 GC/手清）。

---

## 任务状态板

| ID | 状态 | 负责人 | 完成日 | 备注 |
|----|------|--------|--------|------|
| OPT-01 | done | aether | 2026-07-23 | scrape worker + fallback |
| OPT-02 | done | aether | 2026-07-23 | L1+atomic+GC |
| OPT-03 | done | aether | 2026-07-23 | segment stream |
| OPT-04 | done | aether | 2026-07-23 | security + rate limit |
| OPT-05 | done | aether | 2026-07-23 | health fields |
| OPT-06 | done | aether | 2026-07-23 | routes/services split |
| OPT-07 | done | aether | 2026-07-23 | lazy stream |
| OPT-08 | done | aether | 2026-07-23 | AbortController |
| OPT-09 | done | aether | 2026-07-23 | content-visibility |
| OPT-10 | done | aether | 2026-07-23 | enrich cache |
| OPT-11 | done | aether | 2026-07-23 | npm test |
| OPT-12 | done | aether | 2026-07-23 | metrics + admin stats |
| OPT-13 | done | aether | 2026-07-23 | CSS split |
| OPT-14 | done | aether | 2026-07-23 | recombee cap |
| OPT-15 | done | aether | 2026-07-23 | warm backoff + hits |

状态枚举：`todo` | `doing` | `done` | `wontfix` | `blocked`

---

## 非目标（本轮不做）

- 多实例 + Redis 共享缓存（单 VPS 够用）  
- 完整 SSR / SEO  
- 自建全量元数据库  
- 更换播放器内核  
- 大规模 UI 重设计  

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-07-23 | 初版：从代码审阅结论整理 15 项 OPT + 分期与验收 |
| 2026-07-23 | 全部 OPT-01…15 落地；状态板 → done |

---

*实施时以 PR 为单位勾选验收项；完成后把状态板与 DEVELOPMENT.md 一并更新。*
