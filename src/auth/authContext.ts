import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export type StaffRole = 'OWNER' | 'STAFF' | null

export interface AuthApi {
  session: Session | null
  /** Non-null once the signed-in user is matched to an admin_users row. */
  adminRole: StaffRole
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthApi | null>(null)

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
