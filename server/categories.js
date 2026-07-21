/**
 * Categories: mix of HTML list paths (scraped) + Recombee filters/scenarios.
 * Scenarios captured from missav.ws homepage (2026-07-21).
 */
export const CATEGORIES = [
  {
    slug: 'new',
    titleZh: '最近更新',
    titleEn: 'Recent Update',
    listPath: 'new',
    kind: 'scrape',
  },
  {
    slug: 'release',
    titleZh: '新作发行',
    titleEn: 'New Releases',
    listPath: 'release',
    kind: 'scrape',
  },
  {
    slug: 'uncensored-leak',
    titleZh: '无码流出',
    titleEn: 'Uncensored Leak',
    listPath: 'uncensored-leak',
    kind: 'scrape',
    filter: "'is_uncensored_leak' == true",
  },
  {
    slug: 'today-hot',
    titleZh: '今日热门',
    titleEn: 'Today Hot',
    listPath: 'today-hot',
    kind: 'scrape',
  },
  {
    slug: 'weekly-hot',
    titleZh: '本周热门',
    titleEn: 'Weekly Hot',
    listPath: 'weekly-hot',
    kind: 'scrape',
  },
  {
    slug: 'monthly-hot',
    titleZh: '本月热门',
    titleEn: 'Monthly Hot',
    listPath: 'monthly-hot',
    kind: 'scrape',
  },
  {
    slug: 'chinese-subtitle',
    titleZh: '中文字幕',
    titleEn: 'Chinese Subtitle',
    listPath: 'chinese-subtitle',
    kind: 'scrape',
    filter: "'has_chinese_subtitle' == true",
  },
  {
    slug: 'english-subtitle',
    titleZh: '英文字幕',
    titleEn: 'English Subtitle',
    listPath: 'english-subtitle',
    kind: 'scrape',
    filter: "'has_english_subtitle' == true",
  },
  {
    slug: 'jav',
    titleZh: '有码',
    titleEn: 'JAV',
    kind: 'filter',
    filter: "'type' == \"jav\"",
  },
  // genre rails (JP names match Recombee values better)
  {
    slug: 'genre-creampie',
    titleZh: '中出',
    titleEn: 'Creampie',
    kind: 'genre',
    genre: '中出し',
  },
  {
    slug: 'genre-big-breasts',
    titleZh: '巨乳',
    titleEn: 'Big Breasts',
    kind: 'genre',
    genre: '巨乳',
  },
  {
    slug: 'genre-beauty',
    titleZh: '美少女',
    titleEn: 'Pretty Girl',
    kind: 'genre',
    genre: '美少女',
  },
  {
    slug: 'genre-wife',
    titleZh: '人妻',
    titleEn: 'Wife',
    kind: 'genre',
    genre: '人妻・主婦',
  },
  {
    slug: 'genre-mature',
    titleZh: '熟女',
    titleEn: 'Mature',
    kind: 'genre',
    genre: '熟女',
  },
]

export function findCategory(slug) {
  return CATEGORIES.find((c) => c.slug === slug) || null
}

export const HOME_SCENARIOS = {
  recommended: 'desktop-home-recommended',
  segments: 'desktop-home-segments',
  segmentItems: 'desktop-home-segment-items',
}
