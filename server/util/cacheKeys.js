/**
 * Shared cache-key builders so warm / routes / services cannot drift
 * (OPT-16: warm was still writing cat:v12 while catalog read cat:v13).
 *
 * Bump the version suffix only when response shape or loader logic changes.
 */

/** Category list pages (`/api/c/:slug`). v13: studio scrape id accept. */
export const CAT_LIST_VERSION = 'v13'

/**
 * @param {object} p
 * @param {string} p.locale
 * @param {string} p.slug
 * @param {number|string} [p.page=1]
 * @param {number|string} [p.pageSize=24]
 * @param {string} [p.filters='']
 * @param {string} [p.sort='']
 */
export function categoryListKey({
  locale,
  slug,
  page = 1,
  pageSize = 24,
  filters = '',
  sort = '',
}) {
  return `cat:${CAT_LIST_VERSION}:${locale}:${slug}:${page}:${pageSize}:${filters || ''}:${sort || ''}`
}
