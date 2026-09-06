/**
 * Category glyphs.
 *
 * Emoji rather than an icon font or product photography: zero bytes of bundle,
 * renders natively on every Android and iOS phone, and gives the colour that
 * makes a grocery grid scannable. Swap for real photography once the catalogue
 * has images.
 */
const BY_KEYWORD: [RegExp, string][] = [
  [/staple|grain|rice|atta|flour|dal|pulse|dinasi/i, '🌾'],
  [/veg|fruit|fresh|produce/i, '🥬'],
  [/dairy|milk|bread|egg/i, '🥛'],
  [/beverage|tea|coffee|juice|drink/i, '☕'],
  [/snack|biscuit|namkeen|chips/i, '🍪'],
  [/oil|ghee|masala|spice/i, '🫒'],
  [/clean|detergent|laundry|household/i, '🧼'],
  [/personal|care|beauty|soap|shampoo/i, '🧴'],
  [/baby|child/i, '🍼'],
  [/pharma|medicine|health/i, '💊'],
  [/pet/i, '🐾'],
  [/sweet|chocolate|dessert/i, '🍫'],
  [/frozen|ice/i, '🧊'],
  [/meat|fish|chicken|non.?veg/i, '🍗'],
  [/stationery|print/i, '✏️'],
]

export function categoryIcon(name: string): string {
  for (const [re, icon] of BY_KEYWORD) if (re.test(name)) return icon
  return '🛍️'
}

/** Soft tints for category tiles, cycled by index. */
export const TILE_TINTS = [
  '#E8F4EF', '#FFF3DC', '#FDE9E7', '#EAF0FB',
  '#F3ECFB', '#E9F6FA', '#FBF0E3', '#EDF7E6',
] as const
