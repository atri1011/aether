import type { WhosFrame } from '../types'

/**
 * Short label for frame cards / dense grids.
 * Upstream titles look like:
 *   "ekdv-415-uncensored-leak 女优[桜ももい]在 0:37:55 黑色连裤袜室内的精彩画面"
 *   "ipzz-356-uncensored-leak 在 0:19:45 的精彩画面"
 * Prefer the scene phrase; fall back to display code.
 */
export function frameSceneLabel(frame: WhosFrame): string {
  const raw = String(frame.title || '').trim()
  const code = String(frame.displayCode || frame.code || '').trim()

  if (raw) {
    const m = raw.match(/\d{1,2}:\d{2}(?::\d{2})?\s+(.+?)\s*$/)
    if (m?.[1]) {
      const scene = m[1].replace(/的精彩画面$/u, '').trim()
      if (scene.length >= 2) return scene
    }
  }

  if (code) return code
  if (raw) {
    // Drop trailing boilerplate if present
    const cleaned = raw.replace(/的精彩画面$/u, '').trim()
    if (cleaned) return cleaned
  }
  return frame.id
}

/** Detail page primary heading — code first, long prose is secondary. */
export function frameDetailHeading(frame: WhosFrame): string {
  return String(frame.displayCode || frame.code || frame.title || frame.id).trim()
}

/** Detail page secondary line when it adds info beyond the heading. */
export function frameDetailSub(frame: WhosFrame): string | null {
  const heading = frameDetailHeading(frame).toLowerCase()
  const raw = String(frame.title || '').trim()
  if (!raw) return null
  if (raw.toLowerCase() === heading) return null
  if (raw.toLowerCase().startsWith(heading) && raw.length < heading.length + 4) return null

  const scene = frameSceneLabel(frame)
  if (scene && scene.toLowerCase() !== heading) {
    // Prefer a readable scene line over the full slug-heavy title
    if (scene !== frame.displayCode && scene !== frame.code) return scene
  }

  // Last resort: strip code/slug prefix from raw title for readability
  const stripped = raw
    .replace(/^[a-z0-9._-]+(?:-uncensored-leak)?\s*/i, '')
    .replace(/^女优\[[^\]]+\]\s*/u, '')
    .replace(/^在\s*/u, '')
    .replace(/的精彩画面$/u, '')
    .trim()
  if (stripped && stripped.toLowerCase() !== heading) return stripped
  return null
}
