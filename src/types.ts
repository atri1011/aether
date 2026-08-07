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
  /** OPT-07: pending|miss|cached|resolved|error */
  streamStatus?: 'pending' | 'miss' | 'cached' | 'resolved' | 'error'
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
  /** True when /api/home returned only the first rail; client should fetch /api/home/more */
  morePending?: boolean
}

export interface HomeMorePayload {
  latest: VideoSummary[]
  chineseSubtitle: VideoSummary[]
  genreRails?: GenreRail[]
  segments?: string[]
  scenarios?: Record<string, string>
}

export interface CategoryItem {
  slug: string
  title: string
  filter?: string
  kind?: string
  /** Video count from MissAV catalog pages */
  count?: number | null
  listPath?: string
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

/** whos.tv frame card (16:9 scene still) */
export interface WhosFrame {
  id: string
  title: string
  imageUrl: string
  code: string
  displayCode?: string
  timestamp?: string
  actress?: string
  path?: string
  seekSec?: number | null
  label?: string
  tags?: string[]
  videoPath?: string
  /** AETHER watch id when code is a DVD-like slug */
  watchId?: string | null
}

export interface WhosFrameType {
  typeId: number
  type: string
  title: string
  titleZh?: string
  titleEn?: string
}

export interface WhosFrameLabel {
  typeId: number
  type: string
  labelId: number
  name: string
}

export interface WhosTopic {
  id: string
  title: string
  description?: string
  coverUrl: string
  frameCount?: number | null
  videoCount?: number | null
  favoriteCount?: number | null
  path?: string
}

export interface WhosTopicCategory {
  id: string
  slug: string
  title: string
  titleZh?: string
  titleEn?: string
}

/** Hot frame thumb on ranking row (whos.tv 热门帧) */
export interface WhosHotFrame {
  id: string
  imageUrl: string
  title?: string
  path?: string
}

export interface WhosRankingVideo extends VideoSummary {
  rank?: number | null
  rating?: number | null
  /** Right-side 热门帧 carousel for this ranked video */
  hotFrames?: WhosHotFrame[]
  frameImageUrls?: string[]
  frameIds?: string[]
}

export interface WhosRankingActress {
  rank: number
  slug: string
  name: string
  avatarUrl: string
  path?: string
}
