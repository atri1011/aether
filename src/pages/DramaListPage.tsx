import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { Locale, VideoSummary } from '../types'
import { NAV, navTitle, type NavLeaf } from '../nav/navConfig'
import { useLocale } from '../context'
import { DramaCard, DramaSkeletonGrid } from '../components/DramaCard'
import { PagePager } from '../components/PagePager'
import { usePagedList } from '../hooks/usePagedList'

/** Nav leaves under a path prefix — one source of truth for the chip rows. */
function navLeavesFor(prefix: string): NavLeaf[] {
  const leaves: NavLeaf[] = []
  for (const entry of NAV) {
    if (entry.type === 'group') leaves.push(...entry.children.filter((c) => c.to.startsWith(prefix)))
    else if (entry.to.startsWith(prefix)) leaves.push(entry)
  }
  return leaves
}

function labelFor(to: string, locale: Locale) {
  const leaf = navLeavesFor(to).find((l) => l.to === to)
  return leaf ? navTitle(leaf, locale) : ''
}

function CategoryChips({ prefix, active }: { prefix: string; active: string }) {
  const { locale } = useLocale()
  const leaves = navLeavesFor(prefix)
  if (leaves.length < 2) return null
  return (
    <div className="chip-row" role="tablist">
      {leaves.map((leaf) => (
        <Link
          key={leaf.id}
          className={`chip${leaf.to === active ? ' is-active' : ''}`}
          to={leaf.to}
          replace
        >
          {navTitle(leaf, locale)}
        </Link>
      ))}
    </div>
  )
}

type SectionProps = {
  kicker: string
  title: string
  sub: string
  items: VideoSummary[]
  page: number
  maxPage: number | null
  hasMore: boolean
  loading: boolean
  error: string | null
  onPage: (page: number) => void
  toolbar?: ReactNode
}

function DramaSection({
  kicker,
  title,
  sub,
  items,
  page,
  maxPage,
  hasMore,
  loading,
  error,
  onPage,
  toolbar,
}: SectionProps) {
  const { tr } = useLocale()
  return (
    <div className="page drama-page">
      <header className="page-head">
        <div>
          <p className="page-kicker">{kicker}</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{sub}</p>
        </div>
      </header>

      {toolbar}

      {error && items.length === 0 ? (
        <div className="state-block">
          <p>{error}</p>
        </div>
      ) : null}
      {loading && items.length === 0 ? <DramaSkeletonGrid /> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="state-block">
          <p>{tr('empty')}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="drama-grid">
            {items.map((video, i) => (
              <DramaCard key={video.id} video={video} index={i} />
            ))}
          </div>
          <PagePager
            page={page}
            maxPage={maxPage}
            hasMore={hasMore}
            onChange={onPage}
            disabled={loading}
            prevLabel={tr('prevPage')}
            nextLabel={tr('nextPage')}
          />
        </>
      ) : null}
    </div>
  )
}

/** Pager extras + the URL clamp shared by every drama listing. */
function useDramaMeta(meta: Record<string, unknown>, page: number, setPage: (p: number) => void) {
  const maxPage = typeof meta.maxPage === 'number' && meta.maxPage > 0 ? meta.maxPage : null
  // Upstream shrank the list (or the URL is stale) — pull the page back in range.
  useEffect(() => {
    if (maxPage && page > maxPage) setPage(maxPage)
  }, [maxPage, page, setPage])
  return { maxPage, title: typeof meta.title === 'string' ? meta.title : '' }
}

/** 黄果 AI 站分类列表 (sort: 热门 / 最新). */
export function DramaAiListPage({ category }: { category: string }) {
  const { locale, tr } = useLocale()
  const [sort, setSort] = useState<'hot' | 'new'>('hot')
  const { items, page, setPage, hasMore, loading, error, meta } = usePagedList(
    (p, signal) => api.huangguoAiList(locale, { category, page: p, sort }, { signal }),
    [locale, category, sort],
  )
  const { maxPage, title } = useDramaMeta(meta, page, setPage)
  const path = `/drama/ai/${category}`

  return (
    <DramaSection
      kicker={tr('dramaKicker')}
      title={title || labelFor(path, locale)}
      sub={tr('dramaAiSub')}
      items={items}
      page={page}
      maxPage={maxPage}
      hasMore={hasMore}
      loading={loading}
      error={error}
      onPage={setPage}
      toolbar={
        <>
          <CategoryChips prefix="/drama/ai/" active={path} />
          <div className="chip-row chip-row-sub" role="tablist">
            {(['hot', 'new'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip chip-sm${sort === value ? ' is-active' : ''}`}
                onClick={() => {
                  setSort(value)
                  setPage(1)
                }}
              >
                {tr(value === 'hot' ? 'dramaSortHot' : 'dramaSortNew')}
              </button>
            ))}
          </div>
        </>
      }
    />
  )
}

/** One AI-site tag (/drama/tag/:slug). */
export function DramaTagListPage({ slug }: { slug: string }) {
  const { locale, tr } = useLocale()
  const { items, page, setPage, hasMore, loading, error, meta } = usePagedList(
    (p, signal) => api.huangguoAiTag(locale, { slug, page: p }, { signal }),
    [locale, slug],
  )
  const { maxPage, title } = useDramaMeta(meta, page, setPage)

  return (
    <DramaSection
      kicker={tr('dramaTags')}
      title={title || slug}
      sub={tr('dramaTagSub')}
      items={items}
      page={page}
      maxPage={maxPage}
      hasMore={hasMore}
      loading={loading}
      error={error}
      onPage={setPage}
      toolbar={
        <div className="chip-row">
          <Link className="chip" to="/drama/tags">
            {tr('dramaTags')}
          </Link>
        </div>
      }
    />
  )
}

/** 黄果剧场 category listing (all / MV / 短片 / 连续剧 / 片段). */
export function DramaVideoListPage({ category }: { category: string }) {
  const { locale, tr } = useLocale()
  const { items, page, setPage, hasMore, loading, error, meta } = usePagedList(
    (p, signal) => api.huangguoVideoList(locale, { category, page: p }, { signal }),
    [locale, category],
  )
  const { maxPage, title } = useDramaMeta(meta, page, setPage)
  const path = `/drama/video/${category}`

  return (
    <DramaSection
      kicker={tr('dramaKicker')}
      title={title || labelFor(path, locale)}
      sub={tr('dramaVideoSub')}
      items={items}
      page={page}
      maxPage={maxPage}
      hasMore={hasMore}
      loading={loading}
      error={error}
      onPage={setPage}
      toolbar={<CategoryChips prefix="/drama/video/" active={path} />}
    />
  )
}

/** Route-bound entry points — the URL owns the slug. */
export function DramaAiRoute() {
  const { slug = '' } = useParams()
  return <DramaAiListPage category={slug || 'ai-duanju'} />
}

export function DramaTagRoute() {
  const { slug = '' } = useParams()
  return <DramaTagListPage slug={slug} />
}

export function DramaVideoRoute() {
  const { category = '' } = useParams()
  return <DramaVideoListPage category={category || 'all'} />
}
