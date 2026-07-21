export interface VideoSummary {
  id: string
  code: string
  title: string
  titleJa?: string
  coverUrl: string
  durationSec: number
  releasedAt: string | null
  actresses: string[]
  genres: string[]
  tags: string[]
  labels: string[]
  type: string
  hasChineseSubtitle: boolean
  hasEnglishSubtitle: boolean
  isUncensoredLeak: boolean
}

export interface StreamInfo {
  uuid: string
  masterUrl: string
  sources?: { quality: string; url: string }[]
}

export interface VideoDetail extends VideoSummary {
  directors: string[]
  actors: string[]
  series: string[]
  markers: string[]
  stream: StreamInfo | null
  related?: VideoSummary[]
  streamError?: { message: string; details?: string }
}

export interface PagedResult<T> {
  items: T[]
  recommId?: string
  query?: string
  page: number
  pageSize: number
  total: number | null
}

export interface GenreRail {
  id: string
  title: string
  items: VideoSummary[]
}

export interface HomePayload {
  hero: VideoSummary | null
  featured: VideoSummary[]
  latest: VideoSummary[]
  chineseSubtitle: VideoSummary[]
  genreRails?: GenreRail[]
  segments?: string[]
  recommId?: string
  scenarios?: Record<string, string>
}

export interface CategoryItem {
  slug: string
  title: string
  filter: string
}

export interface ActressSummary {
  slug: string
  name: string
  avatarUrl: string
  actressId?: string
  videoCount?: number | null
  debutYear?: number | null
  rank?: number | null
}

export interface ActressStats {
  heightCm: number
  bust: string
  waist: string
  hip: string
  raw?: string
}

export interface ActressProfile extends ActressSummary {
  stats?: ActressStats | null
  birthday?: string | null
  age?: number | null
}

export interface FilterOption {
  value: string
  label: string
}

export interface ActressFilterOptions {
  sort: FilterOption[]
  height: FilterOption[]
  cup: FilterOption[]
  age: FilterOption[]
  debut: FilterOption[]
}

export interface ActressListFilters {
  sort?: string
  height?: string
  cup?: string
  age?: string
  debut?: string
}

/** MissAV-style video list query (filters + sort) */
export interface VideoListQuery {
  filters?: string
  sort?: string
}

export interface VideoFilterOptions {
  filters: FilterOption[]
  sorts: FilterOption[]
}

export type Locale = 'zh' | 'en'
