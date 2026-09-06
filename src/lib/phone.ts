/**
 * Normalise what an Indian customer types into E.164, or null if it cannot be
 * a mobile number. Accepts "9876543210", "09876543210", "919876543210",
 * "+91 98765 43210" and the usual spaces and dashes.
 *
 * The previous version checked `startsWith('91')` on the raw digits, which
 * broke every valid 10-digit number beginning with 91 (a common Jio prefix):
 * "9198765432" became "+9198765432", which no SMS gateway delivers.
 */
export function toE164(input: string): string | null {
  let d = input.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length !== 10) return null
  // Indian mobiles start with 6-9.
  if (!/^[6-9]/.test(d)) return null
  return `+91${d}`
}

/** "+919876543210" -> "98765 43210" for display. */
export function formatIndianMobile(e164: string): string {
  const d = e164.replace(/\D/g, '')
  const local = d.length === 12 && d.startsWith('91') ? d.slice(2) : d
  return local.length === 10 ? `${local.slice(0, 5)} ${local.slice(5)}` : e164
}
