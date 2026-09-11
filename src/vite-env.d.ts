/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Google OAuth web client id; the Google button is hidden when unset. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** Google Maps browser key (public, referrer-restricted); unset = OpenStreetMap map + Photon search. */
  readonly VITE_GOOGLE_MAPS_KEY?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
