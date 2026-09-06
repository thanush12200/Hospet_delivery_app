/**
 * FAA — Fast at any Accuracy. One place for the name, the lines and the
 * colours taken from the logo, so no screen carries its own copy.
 */
export const BRAND = {
  name: 'FAA',
  expansion: 'Fast at any Accuracy',
  tagline: 'FAA it, get it, love it',
  subline: 'Everyday essentials · delivered in minutes',
  city: 'Hospet',
  /** Assets cut from the master logo (public/brand). */
  logo: '/brand/faa-logo.jpg',
  mark: '/brand/faa-mark.png',
  wordmark: '/brand/faa-wordmark.png',
  red: '#E5231F',
  redDark: '#B8181C',
  ink: '#14181F',
} as const

/**
 * Header and status banners. Lighter and warmer than the logo red on purpose:
 * these are large surfaces, and a saturated red block is tiring to look at.
 * The logo red stays for buttons, chips and the tab bar.
 */
export const BRAND_GRADIENT = 'linear-gradient(160deg, #FF8578 0%, #FA6054 45%, #F1443A 100%)'
export const MUTED_GRADIENT = 'linear-gradient(165deg, #5B6472 0%, #3E4552 100%)'
/** Light red tint for selected states. */
export const BRAND_TINT = '#FFF2F1'
export const BRAND_SHADOW = 'rgba(229,35,31,0.35)'
/** Page background: cool light grey so white cards read as cards. */
export const PAGE_BG = '#F4F5F7'
/** Card elevation, soft enough for a grocery app, visible on PAGE_BG. */
export const CARD_SHADOW = '0 1px 2px rgba(20,24,31,0.05), 0 6px 16px rgba(20,24,31,0.06)'
export const HEADER_SHADOW = '0 4px 14px rgba(0,0,0,0.14)'
