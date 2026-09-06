import { useEffect, useRef, useState } from 'react'
import { Typography } from '@mui/material'
import { supabase } from '@/lib/supabase'
import { GOOGLE_CLIENT_ID, loadGoogle, randomNonce, sha256Hex } from '@/lib/google'

/**
 * "Continue with Google", rendered by Google's own library so it carries the
 * account chooser and the branding Google requires. On success the Supabase
 * session is already set when onSignedIn fires; the caller links the
 * customer row and moves on.
 *
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is not configured.
 */
export function GoogleButton({ onSignedIn, onError, disabled }: {
  onSignedIn: () => void | Promise<void>
  onError: (message: string) => void
  disabled?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const latest = useRef({ onSignedIn, onError })
  latest.current = { onSignedIn, onError }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !host.current) return
    let cancelled = false
    const nonce = randomNonce()
    void (async () => {
      try {
        const [id, hashed] = await Promise.all([loadGoogle(), sha256Hex(nonce)])
        if (cancelled || !host.current) return
        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashed,
          itp_support: true,
          callback: (r) => {
            void (async () => {
              const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: r.credential, nonce })
              if (error) { latest.current.onError(error.message); return }
              await latest.current.onSignedIn()
            })()
          },
        })
        host.current.replaceChildren()
        id.renderButton(host.current, {
          theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 320, logo_alignment: 'left',
        })
        setReady(true)
      } catch (e) {
        if (!cancelled) latest.current.onError((e as Error).message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!GOOGLE_CLIENT_ID) return null
  return (
    <div style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div ref={host} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
      {!ready && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>Loading Google sign-in…</Typography>}
    </div>
  )
}
