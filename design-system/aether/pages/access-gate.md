# Access Gate — page override

> Overrides Master for the full-screen password wall only.

**Project:** Aether  
**Page:** Access Gate / Site Passphrase  
**Updated:** 2026-07-23

## Intent

Seductive Soft Cinema entry — intimate, calm luxury, slightly warmer rose/violet whisper than the main archive chrome. Not neon, not pure black, not cyberpunk glitch.

## Layout

- Full-viewport fixed layer (`z-index: 200`)
- Centered glass card `max-width: 420px`
- Ambient aurora blobs (indigo + rose + violet) behind card
- No site chrome (sidebar/topbar) until unlocked

## Color deltas (from Master)

| Role | Value | Notes |
|------|-------|-------|
| Card glass | `linear-gradient(155deg, rgba(28,32,48,.78), rgba(14,17,28,.86))` | richer than main panels |
| CTA gradient | `#8a97ff → #6a5ae8 → #c46db8` | indigo into soft rose — allure, still soft |
| Title gradient | ink → accent-soft → rose → lilac | display only |
| Error | `#f5a0a6` | soft, not alarm red |

## Typography

- Title: Outfit, wide tracking (`0.18em`), gradient fill
- Kicker: uppercase 0.68rem, accent-soft
- Body / hint: Manrope, ink-dim / ink-faint

## Motion

- Card enter: opacity + y 18px, 550ms expo-out
- Error shake: short x keyframes on card re-key
- Ambient blobs: `aether-breathe` 9s
- CTA hover: lift 1px + gradient shift + arrow nudge
- Honor `prefers-reduced-motion` (no blob / shake / spinner spin)

## Form UX

- Visible label (not placeholder-only)
- Password show/hide toggle (44×44 touch target)
- Inline error near field + `role="alert"`
- Loading state on submit (spinner + disabled)
- Min input/button height 52px

## Security (non-UI)

- Gate is presentation only; unlock requires server login + HttpOnly cookie
- Do not store password or session secret in localStorage/React state as “auth truth”
- Wrong password: never reveal whether gate is misconfigured vs wrong pass in UI copy beyond generic errors
