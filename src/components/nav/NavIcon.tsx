import type { NavIconName } from '../../nav/navConfig'

const common = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true as const,
}

export function NavIcon({ name }: { name?: NavIconName }) {
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path
            d="M4.5 10.5 12 4l7.5 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-4V21H5.5a1 1 0 0 1-1-1v-9.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'browse':
      return (
        <svg {...common}>
          <rect x="3.5" y="4" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13.5" y="4" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="3.5" y="13" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
          <rect x="13.5" y="13" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      )
    case 'subtitle':
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7 14h4M13 14h4M7 11h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    case 'jav':
      return (
        <svg {...common}>
          <path
            d="M5 7.5h14M5 12h14M5 16.5h10"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="17.5" cy="16.5" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'actresses':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M5.5 19.5c1.2-3.2 3.4-4.8 6.5-4.8s5.3 1.6 6.5 4.8"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'ranking':
      return (
        <svg {...common}>
          <path d="M5 18V11M12 18V6M19 18v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    case 'genres':
      return (
        <svg {...common}>
          <path
            d="M5 7h14M5 12h10M5 17h12"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="18.5" cy="12" r="1.4" fill="currentColor" />
        </svg>
      )
    case 'makers':
      return (
        <svg {...common}>
          <path
            d="M4.5 18.5V8.2L12 4.5l7.5 3.7v10.3"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9 18.5v-5h6v5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      )
    case 'hot':
      return (
        <svg {...common}>
          <path
            d="M12 3.5c2.2 2.4 4.8 4.2 4.8 8a4.8 4.8 0 1 1-9.6 0c0-2.2 1.1-3.8 2.4-5.2.4 1.7 1.4 2.7 2.4 3.2Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'amateur':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="2.8" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="16" cy="10.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M4.5 18.5c.9-2.6 2.6-3.9 4.8-3.9 1.4 0 2.5.5 3.4 1.3 1-.9 2.2-1.4 3.7-1.4 1.8 0 3.2.8 4.1 2.4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'uncensored':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 12h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      )
    case 'asia':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M5 12h14M12 5c2 2.4 3 4.6 3 7s-1 4.6-3 7c-2-2.4-3-4.6-3-7s1-4.6 3-7Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'vr':
      return (
        <svg {...common}>
          <path
            d="M4 9.5A2.5 2.5 0 0 1 6.5 7h11A2.5 2.5 0 0 1 20 9.5v5A2.5 2.5 0 0 1 17.5 17h-2.2L13 14.2a1.4 1.4 0 0 0-2 0L8.7 17H6.5A2.5 2.5 0 0 1 4 14.5v-5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'list':
    default:
      return (
        <svg {...common}>
          <path
            d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
