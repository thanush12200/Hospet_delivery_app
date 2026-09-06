import { useEffect, useState } from 'react'

/**
 * A search placeholder that types out suggestions one after another, the
 * way the big apps hint at what to search. Pauses when the field has text,
 * and respects reduced-motion by showing a static suggestion.
 */
export function useTypedPlaceholder(terms: string[], active: boolean, prefix = 'Search "', suffix = '"', empty = 'Search'): string {
  const [text, setText] = useState(frame(terms[0] ?? '', prefix, suffix, empty))

  useEffect(() => {
    if (!active || terms.length === 0) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setText(frame(terms[0] ?? '', prefix, suffix, empty)); return }
    let term = 0, pos = 0, deleting = false, timer = 0
    const tick = () => {
      const word = terms[term % terms.length] ?? ''
      if (!deleting) {
        pos++
        setText(frame(word.slice(0, pos), prefix, suffix, empty))
        if (pos >= word.length) { deleting = true; timer = window.setTimeout(tick, 1400); return }
        timer = window.setTimeout(tick, 70)
      } else {
        pos--
        setText(frame(word.slice(0, pos), prefix, suffix, empty))
        if (pos <= 0) { deleting = false; term++; timer = window.setTimeout(tick, 350); return }
        timer = window.setTimeout(tick, 35)
      }
    }
    timer = window.setTimeout(tick, 600)
    return () => clearTimeout(timer)
  }, [terms, active, prefix, suffix, empty])

  return text
}

/** Between words the quotes would wrap nothing; show the plain label instead. */
function frame(typed: string, prefix: string, suffix: string, empty: string): string {
  return typed ? `${prefix}${typed}${suffix}` : empty
}
