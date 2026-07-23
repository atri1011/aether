/**
 * Categories: mix of HTML list paths (scraped) + Recombee filters/scenarios.
 * Aligned with missav.ai primary nav (login / ads / collections omitted).
 */

/**
 * Studio / list scrape category.
 *
 * extra:
 *   filter       – Recombee filter expression (optional)
 *   searchQuery  – Recombee search query used ONLY as scrape fallback
 *                  (never recommendForUser — that mixes unrelated titles)
 *   idPrefix     – post-filter item ids must start with one of these (lower)
 */
function scrape(slug, titleZh, titleEn, listPath = slug, extra = {}) {
  return { slug, titleZh, titleEn, listPath, kind: 'scrape', ...extra }
}

/** Normalize studio id prefixes for post-filter (accept string or string[]). */
export function categoryIdPrefixes(cat) {
  const raw = cat?.idPrefix
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean)
}

/**
 * Keep only items whose id matches a studio prefix (when configured).
 * Used for Recombee search fallback so /c/fc2 never shows random JAV.
 * Prefix match: exact, `prefix-…`, `prefix_…`, or raw startsWith(prefix).
 */
export function filterItemsByCategoryPrefix(items, cat) {
  const prefixes = categoryIdPrefixes(cat)
  if (!prefixes.length) return items || []
  return (items || []).filter((it) => {
    const id = String(it?.id || '')
      .toLowerCase()
      .trim()
    if (!id) return false
    return prefixes.some(
      (p) => id === p || id.startsWith(`${p}-`) || id.startsWith(`${p}_`) || id.startsWith(p),
    )
  })
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

  // ── Popular genre shortcuts (full catalog is scraped from MissAV /genres) ──
  // listPath uses MissAV CN genre names so HTML scrape hits the same lists.
  genre('genre-creampie', '中出', 'Creampie', '中出', 'genres/中出'),
  genre('genre-big-breasts', '巨乳', 'Big Breasts', '巨乳', 'genres/巨乳'),
  genre('genre-beauty', '美少女', 'Pretty Girl', '美少女', 'genres/美少女'),
  genre('genre-wife', '人妻', 'Wife', '人妻', 'genres/人妻'),
  genre('genre-mature', '熟女', 'Mature', '熟女', 'genres/熟女'),
  genre('genre-hd', '高清', 'HD', '高清', 'genres/高清'),
  genre('genre-exclusive', '独家', 'Exclusive', '独家', 'genres/独家'),
  genre('genre-amateur', '素人', 'Amateur', '素人', 'genres/素人'),
  genre('genre-oral', '口交', 'Oral Sex', '口交', 'genres/口交'),
  genre('genre-ntr', 'NTR', 'NTR', 'NTR', 'genres/NTR'),
  genre('genre-4k', '4K', '4K', '4K', 'genres/4K'),

  // ── Amateur ───────────────────────────────────────────────
  // searchQuery + idPrefix: when MissAV HTML scrape 403/empty, fall back to
  // Recombee *search* (not recommendForUser) so /c/fc2 never shows random JAV.
  scrape('siro', 'SIRO', 'SIRO', 'siro', {
    searchQuery: 'SIRO',
    idPrefix: ['siro'],
  }),
  scrape('luxu', 'LUXU', 'LUXU', 'luxu', {
    searchQuery: 'LUXU',
    idPrefix: ['luxu'],
  }),
  scrape('gana', 'GANA', 'GANA', 'gana', {
    searchQuery: 'GANA',
    idPrefix: ['gana'],
  }),
  scrape('maan', 'PRESTIGE PREMIUM', 'PRESTIGE PREMIUM', 'maan', {
    searchQuery: 'MIUM',
    idPrefix: ['mium', 'maan', 'pret'],
  }),
  scrape('scute', 'S-CUTE', 'S-CUTE', 'scute', {
    searchQuery: 'S-CUTE',
    idPrefix: ['scute'],
  }),
  scrape('ara', 'ARA', 'ARA', 'ara', {
    searchQuery: 'ARA',
    idPrefix: ['ara'],
  }),

  // ── Uncensored studios ────────────────────────────────────
  scrape('fc2', 'FC2', 'FC2', 'fc2', {
    searchQuery: 'FC2-PPV',
    idPrefix: ['fc2'],
  }),
  scrape('heyzo', 'HEYZO', 'HEYZO', 'heyzo', {
    searchQuery: 'HEYZO',
    idPrefix: ['heyzo'],
  }),
  scrape('tokyohot', '东京热', 'Tokyo Hot', 'tokyohot', {
    searchQuery: 'Tokyo Hot',
    idPrefix: ['tokyohot', 'tokyo-hot'],
  }),
  scrape('1pondo', '一本道', '1pondo', '1pondo', {
    searchQuery: '1pondo',
    // bare MissAV ids are date codes (071126_001); only apply prefix on Recombee rows
    idPrefix: ['1pondo', 'pondo'],
  }),
  scrape('caribbeancom', 'Caribbeancom', 'Caribbeancom', 'caribbeancom', {
    searchQuery: 'Caribbeancom',
    idPrefix: ['caribbeancom'],
  }),
  scrape('caribbeancompr', 'Caribbeancompr', 'Caribbeancompr', 'caribbeancompr', {
    searchQuery: 'Caribbeancompr',
    idPrefix: ['caribbeancompr'],
  }),
  scrape('10musume', '10musume', '10musume', '10musume', {
    searchQuery: '10musume',
    idPrefix: ['10musume'],
  }),
  scrape('pacopacomama', 'pacopacomama', 'pacopacomama', 'pacopacomama', {
    searchQuery: 'pacopacomama',
    idPrefix: ['pacopacomama', 'paco'],
  }),
  scrape('gachinco', 'Gachinco', 'Gachinco', 'gachinco', {
    searchQuery: 'Gachinco',
    idPrefix: ['gachinco', 'gachi'],
  }),
  scrape('xxxav', 'XXX-AV', 'XXX-AV', 'xxxav', {
    searchQuery: 'XXX-AV',
    idPrefix: ['xxx-av', 'xxxav'],
  }),
  scrape('marriedslash', '人妻斩', 'Married Slash', 'marriedslash', {
    searchQuery: 'C0930',
    idPrefix: ['c0930', 'h0930'],
  }),
  scrape('naughty4610', '顽皮 4610', 'Naughty 4610', 'naughty4610', {
    searchQuery: 'H4610',
    idPrefix: ['h4610'],
  }),
  scrape('naughty0930', '顽皮 0930', 'Naughty 0930', 'naughty0930', {
    searchQuery: 'H0930',
    idPrefix: ['h0930'],
  }),

  // ── Asia AV ───────────────────────────────────────────────
  scrape('madou', '麻豆传媒', 'Madou', 'madou', {
    searchQuery: '麻豆',
    idPrefix: ['madou', 'msd', 'mkym', 'cus-', 'pmc'],
  }),
  scrape('twav', 'TWAV', 'TWAV', 'twav', {
    searchQuery: 'TWAV',
    idPrefix: ['twav'],
  }),
  scrape('furuke', 'Furuke', 'Furuke', 'furuke', {
    searchQuery: 'Furuke',
    idPrefix: ['furuke', 'edmosaic'],
  }),
  scrape('klive', '韩国直播', 'Korean Live', 'klive', {
    searchQuery: 'KBJ',
    idPrefix: ['kbj', 'klive'],
  }),
  scrape('clive', '中国直播', 'Chinese Live', 'clive', {
    searchQuery: 'CN-',
    idPrefix: ['cn-', 'clive'],
  }),
]

/** Group meta for genres / makers index pages */
export const CATEGORY_GROUPS = {
  genres: {
    titleZh: '类型',
    titleEn: 'Genres',
    // Fallback chips when MissAV catalog scrape fails.
    // Live /api/genres scrapes the full MissAV list (~24 pages).
    slugs: [
      'vr',
      'genre-hd',
      'genre-exclusive',
      'genre-creampie',
      'genre-big-breasts',
      'genre-wife',
      'genre-mature',
      'genre-amateur',
      'genre-beauty',
      'genre-oral',
      'genre-ntr',
      'genre-4k',
      'chinese-subtitle',
      'english-subtitle',
      'jav',
    ],
  },
  makers: {
    titleZh: '发行商',
    titleEn: 'Makers',
    // Fallback: sidebar studios. Full maker catalog is scraped from MissAV.
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

/**
 * Resolve a category slug that may be a static entry or a MissAV catalog path.
 * Dynamic forms:
 *   genres/<name>  → scrape listPath genres/<name>
 *   makers/<name>  → scrape listPath makers/<name>
 */
export function resolveCategory(slug) {
  const raw = String(slug || '')
    .replace(/^\/+/, '')
    .trim()
  if (!raw) return null

  const staticCat = findCategory(raw)
  if (staticCat) return staticCat

  // decode once (route may pass encoded segments)
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }

  const static2 = findCategory(decoded)
  if (static2) return static2

  const m = decoded.match(/^(genres|makers)\/(.+)$/i)
  if (!m) return null
  const kind = m[1].toLowerCase()
  const name = m[2].trim()
  if (!name) return null
  return {
    slug: `${kind}/${name}`,
    titleZh: name,
    titleEn: name,
    kind: 'scrape',
    listPath: `${kind}/${name}`,
    dynamic: true,
  }
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
