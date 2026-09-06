/**
 * Google Identity Services (the "Continue with Google" button) feeding
 * Supabase's id-token sign-in.
 *
 * Why the button and not the OAuth redirect: the redirect flow leaves the
 * page, and inside an installed PWA on iOS it comes back to Safari rather
 * than the home-screen app. The GIS button returns an ID token in-page, and
 * supabase.auth.signInWithIdToken() turns it into a session with no
 * navigation at all.
 *
 * Nonce: Google gets the SHA-256 of a random nonce and signs it into the
 * token; Supabase gets the raw nonce and checks the hash. A token replayed
 * from another site would carry the wrong nonce.
 *
 * Needs VITE_GOOGLE_CLIENT_ID (public, the OAuth web client id). Without it
 * the button simply is not rendered.
 */

export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
const GSI_SRC = 'https://accounts.google.com/gsi/client'

export interface GoogleCredential { credential: string }
export interface GoogleButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  width?: number
  logo_alignment?: 'left' | 'center'
}
interface GoogleAccountsId {
  initialize: (cfg: { client_id: string; callback: (r: GoogleCredential) => void; nonce?: string; use_fedcm_for_prompt?: boolean; itp_support?: boolean }) => void
  renderButton: (el: HTMLElement, opts: GoogleButtonOptions) => void
}
declare global {
  interface Window { google?: { accounts: { id: GoogleAccountsId } } }
}

let loading: Promise<GoogleAccountsId> | null = null

/** Load the GIS script once; resolves with google.accounts.id. */
export function loadGoogle(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GSI_SRC; s.async = true; s.defer = true
      s.onload = () => {
        const id = window.google?.accounts?.id
        if (id) resolve(id); else reject(new Error('Google sign-in did not load'))
      }
      s.onerror = () => { loading = null; reject(new Error('Google sign-in could not be loaded. Check your connection.')) }
      document.head.appendChild(s)
    })
  }
  return loading
}

export function randomNonce(bytes = 16): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
