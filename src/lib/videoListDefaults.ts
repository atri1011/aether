/**
 * Default list sorts — keep in sync with server/videoFilters.js DEFAULT_SORT.
 * Hot rails must use view-based sorts; otherwise MissAV returns recent updates.
 */
export function defaultSortForCategory(slug?: string | null): string {
  switch (String(slug || '')) {
    case 'today-hot':
      return 'today_views'
    case 'weekly-hot':
      return 'weekly_views'
    case 'monthly-hot':
      return 'monthly_views'
    case 'release':
      return 'released_at'
    default:
      return String(slug || '').includes('hot') ? 'today_views' : 'published_at'
  }
}
