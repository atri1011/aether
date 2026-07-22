/**
 * Categories: mix of HTML list paths (scraped) + Recombee filters/scenarios.
 * Aligned with missav.ai primary nav (login / ads / collections omitted).
 */

function scrape(slug, titleZh, titleEn, listPath = slug, extra = {}) {
  return { slug, titleZh, titleEn, listPath, kind: 'scrape', ...extra }
}

function genre(slug, titleZh, titleEn, genre, listPath) {
  return {
    slug,
    titleZh,
    titleEn,
    kind: 'genre',
    genre,
    listPath: listPath || `genres/${genre}`,
  }
}

export const CATEGORIES = [
  // ── Watch JAV / hot rails ─────────────────────────────────
  scrape('new', '最近更新', 'Recent Update'),
  scrape('release', '新作上市', 'New Releases'),
  scrape('uncensored-leak', '无码流出', 'Uncensored Leak', 'uncensored-leak', {
    filter: "'is_uncensored_leak' == true",
  }),
  scrape('today-hot', '今日热门', 'Today Hot'),
  scrape('weekly-hot', '本周热门', 'Weekly Hot'),
  scrape('monthly-hot', '本月热门', 'Monthly Hot'),
  scrape('chinese-subtitle', '中文字幕', 'Chinese Subtitle', 'chinese-subtitle', {
    filter: "'has_chinese_subtitle' == true",
  }),
  scrape('english-subtitle', '英文字幕', 'English Subtitle', 'english-subtitle', {
    filter: "'has_english_subtitle' == true",
  }),
  scrape('vr', 'VR', 'VR', 'genres/VR'),

  // ── Recombee type filter ──────────────────────────────────
  {
    slug: 'jav',
    titleZh: '有码',
    titleEn: 'JAV',
    kind: 'filter',
    filter: "'type' == \"jav\"",
  },

  // ── Genre rails (JP names match Recombee values better) ───
  genre('genre-creampie', '中出', 'Creampie', '中出し'),
  genre('genre-big-breasts', '巨乳', 'Big Breasts', '巨乳'),
  genre('genre-beauty', '美少女', 'Pretty Girl', '美少女'),
  genre('genre-wife', '人妻', 'Wife', '人妻・主婦'),
  genre('genre-mature', '熟女', 'Mature', '熟女'),

  // ── Amateur ───────────────────────────────────────────────
  scrape('siro', 'SIRO', 'SIRO'),
  scrape('luxu', 'LUXU', 'LUXU'),
  scrape('gana', 'GANA', 'GANA'),
  scrape('maan', 'PRESTIGE PREMIUM', 'PRESTIGE PREMIUM'),
  scrape('scute', 'S-CUTE', 'S-CUTE'),
  scrape('ara', 'ARA', 'ARA'),

  // ── Uncensored studios ────────────────────────────────────
  scrape('fc2', 'FC2', 'FC2'),
  scrape('heyzo', 'HEYZO', 'HEYZO'),
  scrape('tokyohot', '东京热', 'Tokyo Hot'),
  scrape('1pondo', '一本道', '1pondo'),
  scrape('caribbeancom', 'Caribbeancom', 'Caribbeancom'),
  scrape('caribbeancompr', 'Caribbeancompr', 'Caribbeancompr'),
  scrape('10musume', '10musume', '10musume'),
  scrape('pacopacomama', 'pacopacomama', 'pacopacomama'),
  scrape('gachinco', 'Gachinco', 'Gachinco'),
  scrape('xxxav', 'XXX-AV', 'XXX-AV'),
  scrape('marriedslash', '人妻斩', 'Married Slash'),
  scrape('naughty4610', '顽皮 4610', 'Naughty 4610'),
  scrape('naughty0930', '顽皮 0930', 'Naughty 0930'),

  // ── Asia AV ───────────────────────────────────────────────
  scrape('madou', '麻豆传媒', 'Madou'),
  scrape('twav', 'TWAV', 'TWAV'),
  scrape('furuke', 'Furuke', 'Furuke'),
  scrape('klive', '韩国直播', 'Korean Live'),
  scrape('clive', '中国直播', 'Chinese Live'),
]

/** Group meta for genres / makers index pages */
export const CATEGORY_GROUPS = {
  genres: {
    titleZh: '类型',
    titleEn: 'Genres',
    slugs: [
      'vr',
      'genre-creampie',
      'genre-big-breasts',
      'genre-beauty',
      'genre-wife',
      'genre-mature',
      'chinese-subtitle',
      'english-subtitle',
      'jav',
    ],
  },
  makers: {
    titleZh: '发行商',
    titleEn: 'Makers',
    slugs: [
      'siro',
      'luxu',
      'gana',
      'maan',
      'scute',
      'ara',
      'fc2',
      'heyzo',
      'tokyohot',
      '1pondo',
      'caribbeancom',
      'caribbeancompr',
      '10musume',
      'pacopacomama',
      'gachinco',
      'xxxav',
      'marriedslash',
      'naughty4610',
      'naughty0930',
      'madou',
      'twav',
      'furuke',
      'klive',
      'clive',
    ],
  },
}

export function findCategory(slug) {
  return CATEGORIES.find((c) => c.slug === slug) || null
}

export function categoriesBySlugs(slugs, locale = 'zh') {
  const en = String(locale || '').toLowerCase().startsWith('en')
  return slugs
    .map((slug) => {
      const c = findCategory(slug)
      if (!c) return null
      return {
        slug: c.slug,
        title: en ? c.titleEn : c.titleZh,
        kind: c.kind,
        filter: c.filter,
      }
    })
    .filter(Boolean)
}

export const HOME_SCENARIOS = {
  recommended: 'desktop-home-recommended',
  segments: 'desktop-home-segments',
  segmentItems: 'desktop-home-segment-items',
}
