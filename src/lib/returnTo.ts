/** Only ever go back to somewhere inside this app. */
export function safeReturnTo(raw: string | null, fallback: string): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  return raw
}
