import { sanitizeErrorDetails } from '../middleware/security.js'

export function sendError(res, status, code, error, details) {
  const body = { error, code }
  const safe = sanitizeErrorDetails(details)
  if (safe !== undefined) body.details = safe
  res.status(status).json(body)
}
