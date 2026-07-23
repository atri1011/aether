import { mapRecomms } from '../map.js'
import {
  recommendByGenre,
  recommendForUser,
  recommendHome,
  recommendSegments,
  searchItems,
} from '../recombee.js'
import { pyScrapeList } from '../pybridge.js'
import { mapScrapeItemsEnriched } from './scrapeMap.js'

export async function loadChineseSubtitleRail(locale, count = 12) {
  // Recombee search is keyword-sensitive: CJK query "字幕" often returns 0 hits.
  // Prefer filter-based recommend, then neutral keyword search, then HTML scrape.
  const filter = "'has_chinese_subtitle' == true"
  const attempts = [
    () => recommendForUser({ count, filter }),
    () => searchItems('chinese', { count, filter }),
    () => searchItems('a', { count, filter }),
  ]
  for (const run of attempts) {
    try {
      const raw = await run()
      const mapped = mapRecomms(raw, locale)
      if (mapped.items.length) return mapped.items
    } catch {
      // try next strategy
    }
  }
  try {
    const scraped = await pyScrapeList('chinese-subtitle', 1, locale)
    if (scraped?.ok && scraped.items?.length) {
      return (await mapScrapeItemsEnriched(scraped.items, locale)).slice(0, count)
    }
  } catch {
    // empty rail
  }
  return []
}

export async function loadHomePrime(locale) {
  const featuredRaw = await recommendHome({ count: 16 }).catch(() =>
    recommendForUser({ count: 16 }),
  )
  const featured = mapRecomms(featuredRaw, locale)
  return {
    hero: featured.items[0] || null,
    featured: featured.items.slice(0, 10),
    latest: [],
    chineseSubtitle: [],
    genreRails: [],
    segments: [],
    recommId: featured.recommId,
    scenarios: {
      featured: 'desktop-home-recommended',
      segments: 'desktop-home-segments',
    },
    morePending: true,
  }
}

export async function loadHomeMore(locale) {
  const [segmentsRaw, chineseItems, newScrape] = await Promise.all([
    recommendSegments({ count: 8 }).catch(() => ({ recomms: [] })),
    loadChineseSubtitleRail(locale, 12),
    pyScrapeList('new', 1, locale).catch(() => null),
  ])

  const segmentIds = (segmentsRaw.recomms || []).map((r) => r.id).filter(Boolean)

  const genreRails = (
    await Promise.all(
      segmentIds.slice(0, 3).map(async (g) => {
        try {
          const rail = await recommendByGenre(g, { count: 12 })
          const items = mapRecomms(rail, locale).items
          if (!items.length) return null
          return { id: g, title: g, items }
        } catch {
          return null
        }
      }),
    )
  ).filter(Boolean)

  let latest = []
  if (newScrape?.ok && newScrape.items?.length) {
    latest = (await mapScrapeItemsEnriched(newScrape.items, locale)).slice(0, 16)
  }

  return {
    latest,
    chineseSubtitle: chineseItems,
    genreRails,
    segments: segmentIds,
    scenarios: {
      segments: 'desktop-home-segments',
    },
  }
}
