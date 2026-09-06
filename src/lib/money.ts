/** Money helpers. Everything in the system is integer paise; only these
 *  functions are permitted to produce a human-readable rupee string. */

export function paiseToRupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const p = abs % 100
  const grouped = rupees.toLocaleString('en-IN')
  return p === 0 ? `${sign}₹${grouped}` : `${sign}₹${grouped}.${String(p).padStart(2, '0')}`
}

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100)
