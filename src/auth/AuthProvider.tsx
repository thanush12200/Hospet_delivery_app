import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { AuthContext, type AuthApi, type StaffRole } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [adminRole, setAdminRole] = useState<StaffRole>(null)
  const [loading, setLoading] = useState(true)

  // Being signed in is not the same as being staff. The database is the
  // authority -- this lookup only decides what UI to render, and every admin
  // RPC re-checks is_admin() server-side regardless.
  const resolveRole = useCallback(async (s: Session | null) => {
    if (!s) { setAdminRole(null); return }
    const { data } = await supabase
      .from('admin_users').select('role').eq('auth_uid', s.user.id).maybeSingle()
    setAdminRole((data?.role as StaffRole) ?? null)
  }, [])

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await resolveRole(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      void resolveRole(s)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [resolveRole])

  const api = useMemo<AuthApi>(() => ({
    session,
    adminRole,
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error?.message ?? null }
    },
    signOut: async () => { await supabase.auth.signOut() },
  }), [session, adminRole, loading])

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}
