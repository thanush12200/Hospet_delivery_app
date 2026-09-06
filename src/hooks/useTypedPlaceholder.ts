import { useEffect, useState } from 'react'

/**
 * A search placeholder that types out suggestions one after another, the
 * way the big apps hint at what to search. Pauses when the field has text,
 * and respects reduced-motion by showing a static suggestion.
 */
export function useTypedPlaceholder(terms: string[], active: boolean, prefix = 'Search "', suffix = '"'): string {
  const [text, setText] = useState(terms[0] ? `${prefix}${terms[0]}${suffix}` : '')

  useEffect(() => {
    if (!active || terms.length === 0) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setText(`${prefix}${terms[0]}${suffix}`); return }
    let term = 0, pos = 0, deleting = false, timer = 0
    const tick = () => {
      const word = terms[term % terms.length] ?? ''
      if (!deleting) {
        pos++
        setText(`${prefix}${word.slice(0, pos)}${suffix}`)
        if (pos >= word.length) { deleting = true; timer = window.setTimeout(tick, 1400); return }
        timer = window.setTimeout(tick, 70)
      } else {
        pos--
        setText(`${prefix}${word.slice(0, pos)}${suffix}`)
        if (pos <= 0) { deleting = false; term++; timer = window.setTimeout(tick, 350); return }
        timer = window.setTimeout(tick, 35)
      }
    }
    timer = window.setTimeout(tick, 600)
    return () => clearTimeout(timer)
  }, [terms, active, prefix, suffix])

  return text
}
