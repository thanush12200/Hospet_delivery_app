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

/** Header and status banners. */
export const BRAND_GRADIENT = `linear-gradient(165deg, #F0322B 0%, ${BRAND.red} 55%, ${BRAND.redDark} 100%)`
export const MUTED_GRADIENT = 'linear-gradient(165deg, #5B6472 0%, #3E4552 100%)'
/** Light red tint for selected states. */
export const BRAND_TINT = '#FFF2F1'
export const BRAND_SHADOW = 'rgba(229,35,31,0.35)'
