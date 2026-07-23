export function localeOf(req) {
  const q = String(req.query.locale || req.headers['x-locale'] || 'zh').toLowerCase()
  return q.startsWith('en') ? 'en' : 'zh'
}

export function qStr(v) {
  if (v == null) return ''
  return String(v).trim()
}
