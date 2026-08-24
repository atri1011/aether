/**
 * External Chinese-subtitle matching (SUB-01).
 *
 * Network work (Xunlei oracle + SubtitleCat scrape) lives in Python
 * (py/subtitles.py via the scrape worker RPC); this module owns the Node side:
 * code normalization, candidate ranking, SRT/ASS→WebVTT conversion and caching.
 */
import { createHash } from 'node:crypto'
import { pySubtitleFetch, pySubtitleSearch } from '../pybridge.js'
import { withCache } from './cacheWrap.js'

/** Candidate search — upstream catalogs change slowly, negatives included. */
const SEARCH_TTL = 30 * 60 * 1000
/** Converted VTT bodies are immutable enough to cache for a week. */
const TEXT_TTL = 7 * 24 * 60 * 60 * 1000

/** Mirror of the allowlist enforced inside py/subtitles.py. */
const HOST_ALLOW_SUFFIXES = ('xunlei.com geilijiasu.com subtitlecat.com').split(' ')

const CODE_RE = /^([A-Za-z]{2,6})[-_ ]?(\d{2,5})$/
/** MissAV ids append variant suffixes; canonical release codes drop them. */
const ID_SUFFIXES = [
  '-chinese-subtitle',
  '-english-subtitle',
  '-uncensored-leak',
  '-uncensored',
]

export function normalizeCode(raw) {
  let s = String(raw || '').trim().toLowerCase()
  for (const suffix of ID_SUFFIXES) {
    if (s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  s = s.replace(/^[-_ ]+|[-_ ]+$/g, '')
  const m = CODE_RE.exec(s)
  if (m) return `${m[1].toUpperCase()}-${m[2]}`
  return s.toUpperCase()
}

export function isAllowedSubtitleUrl(url) {
  try {
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = (u.hostname || '').toLowerCase()
    return HOST_ALLOW_SUFFIXES.some(
      (s) => host === s || host.endsWith(`.${s}`),
    )
  } catch {
    return false
  }
}

export function guessExt(url) {
  try {
    const path = new URL(String(url)).pathname.toLowerCase()
    const m = /\.(srt|ass|ssa|vtt)(?:$|\?)/.exec(path)
    return m ? m[1] : 'srt'
  } catch {
    return 'srt'
  }
}

// ------------------------------------------------------------- VTT conversion

function padMs(frac) {
  return String(frac).padEnd(3, '0').slice(0, 3)
}

/** `0:01:02.34` / `0:01:02,340` → `00:01:02.340`; null when not an ASS time. */
function assTimeToVtt(t) {
  const m = /^\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*$/.exec(String(t))
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${padMs(m[4])}`
}

/** Minimal ASS/SSA → VTT: [Events] Dialogue lines, override tags stripped. */
export function assToVtt(text) {
  const out = []
  let section = ''
  let format = null
  for (const rawLine of String(text).split(/\r?\n/)) {
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine)
    if (sec) {
      section = sec[1].toLowerCase()
      continue
    }
    if (section !== 'events') continue
    const line = rawLine.trim()
    const fmt = /^Format\s*:\s*(.+)$/i.exec(line)
    if (fmt) {
      format = fmt[1].split(',').map((f) => f.trim().toLowerCase())
      continue
    }
    const dlg = /^Dialogue\s*:\s*(.*)$/i.exec(line)
    if (!dlg || !format) continue
    const ti = format.indexOf('text')
    const si = format.indexOf('start')
    const ei = format.indexOf('end')
    if (ti < 0 || si < 0 || ei < 0 || ei >= ti || si >= ti) continue
    // Text is last — rejoin in case it contains commas.
    const fields = dlg[1].split(',')
    const start = assTimeToVtt(fields[si])
    const end = assTimeToVtt(fields[ei])
    const body = fields
      .slice(ti)
      .join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .trim()
    if (!start || !end || !body) continue
    out.push(`${start} --> ${end}\n${body}`)
  }
  if (!out.length) return null
  return `WEBVTT\n\n${out.map((c, i) => `${i + 1}\n${c}`).join('\n\n')}\n`
}

/**
 * SRT (or pass-through VTT) → WebVTT. Returns null when the payload carries
 * neither a WEBVTT header nor any cue timing line.
 */
export function srtToVtt(text) {
  const body = String(text).replace(/^﻿/, '')
  if (/^\s*WEBVTT/i.test(body)) return body
  const lines = body.split(/\r?\n/)
  let sawCue = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('-->') || !/\d/.test(line)) continue
    const converted = line.replace(
      /(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})/g,
      (_, h, m, s, ms) =>
        `${h.padStart(2, '0')}:${m}:${s}.${padMs(ms)}`,
    )
    lines[i] = converted
    sawCue = true
  }
  if (!sawCue) return null
  return `WEBVTT\n\n${lines.join('\n')}\n`
}

/** Route by container; unknown extensions go through the SRT path. */
export function toVtt(text, ext) {
  const e = String(ext || '').toLowerCase()
  if (e === 'ass' || e === 'ssa') return assToVtt(text)
  return srtToVtt(text)
}

// -------------------------------------------------------------------- ranking

/**
 * Deterministic preference order. Higher score wins:
 *   +40/+25/+10 exact/close/coarse duration match (uploader-reported length
 *     vs the video's real runtime) — the strongest sync signal we have
 *   +20 human-uploaded Xunlei over machine-translated SubtitleCat
 *   +8 Simplified Chinese, +3 Traditional
 */
export function rankSubtitles(items, durationSec = 0) {
  const dur = Number(durationSec) || 0
  const score = (it) => {
    let s = 0
    if (dur > 0 && it?.durationSec > 0) {
      const diff = Math.abs(Number(it.durationSec) - dur)
      if (diff <= 5) s += 40
      else if (diff <= 60) s += 25
      else if (diff <= 180) s += 10
      else s -= 15
    }
    if (it?.source === 'xunlei') s += 20
    if (it?.lang === 'zh-CN') s += 8
    else if (it?.lang === 'zh-TW') s += 3
    return s
  }
  return [...(items || [])]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => score(b.it) - score(a.it) || a.i - b.i)
    .map((x) => x.it)
}

// ------------------------------------------------------------------- loaders

/**
 * Ranked Chinese-subtitle candidates for a watch id (release-code lookup).
 * Cached per normalized code + rounded duration.
 */
export async function searchSubtitles(id, { durationSec = 0 } = {}) {
  const norm = normalizeCode(id)
  if (!norm) {
    const err = new Error('id required')
    err.code = 'CONFIG'
    throw err
  }
  const dur = Math.max(0, Math.round(Number(durationSec) || 0))
  const key = `subs:v1:search:${norm}:${dur}`
  const { data } = await withCache(key, SEARCH_TTL, async () => {
    const res = await pySubtitleSearch(norm, dur)
    if (!res?.ok) {
      const err = new Error(res?.error || 'subtitle search failed')
      err.details = res
      throw err
    }
    return {
      code: res.code || norm,
      durationSec: dur,
      items: rankSubtitles(res.items || [], dur),
    }
  })
  return data
}

/**
 * Fetch one upstream subtitle file (host allowlisted) and return it converted
 * to WebVTT text. Cached by URL hash — the conversion is pure.
 */
export async function loadSubtitleVtt(url) {
  if (!isAllowedSubtitleUrl(url)) {
    const err = new Error('subtitle host not allowed')
    err.code = 'CONFIG'
    throw err
  }
  const hash = createHash('sha256').update(String(url)).digest('hex').slice(0, 32)
  const { data } = await withCache(
    `subs:v1:text:${hash}`,
    TEXT_TTL,
    async () => {
      const res = await pySubtitleFetch(url)
      if (!res?.ok || typeof res.text !== 'string') {
        const err = new Error(res?.error || 'subtitle fetch failed')
        err.details = res
        throw err
      }
      const ext = guessExt(url)
      const vtt = toVtt(res.text, ext)
      if (!vtt) {
        const err = new Error(`unrecognized subtitle payload (${ext})`)
        err.code = 'PARSE'
        throw err
      }
      return {
        vtt,
        encoding: res.encoding || '',
        bytes: res.bytes || 0,
        cjkRatio: res.cjkRatio ?? null,
      }
    },
  )
  return data
}
