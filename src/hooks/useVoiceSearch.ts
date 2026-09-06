import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechResultEvent extends Event { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
interface Recognizer {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number
  start: () => void; stop: () => void; abort: () => void
  onresult: ((e: SpeechResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
type RecognizerCtor = new () => Recognizer
declare global {
  interface Window { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor }
}

function ctor(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

/**
 * Tap the mic, say "toor dal", see it typed. Uses the browser's own speech
 * recognition (Chrome on Android, Safari on iOS); the mic is hidden where
 * it is not available. Indian English; Kannada words are usually caught
 * too since product names in the catalogue are transliterated.
 *
 *   onText(text, final) fires as words arrive and once more when done.
 */
export function useVoiceSearch(onText: (text: string, final: boolean) => void, lang = 'en-IN') {
  const [supported] = useState(() => ctor() != null)
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognizer | null>(null)
  const cb = useRef(onText)
  cb.current = onText

  const stop = useCallback(() => { rec.current?.stop(); setListening(false) }, [])

  const start = useCallback(() => {
    const C = ctor()
    if (!C) return
    rec.current?.abort()
    const r = new C()
    r.lang = lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1
    r.onresult = (e) => {
      let text = ''; let final = false
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        if (!res) continue
        text += res[0]?.transcript ?? ''
        if (res.isFinal) final = true
      }
      cb.current(text.trim(), final)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    try { r.start(); setListening(true) } catch { setListening(false) }
  }, [lang])

  useEffect(() => () => rec.current?.abort(), [])

  return { supported, listening, start, stop }
}
