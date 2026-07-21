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

export type Locale = 'zh' | 'en'
