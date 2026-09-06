import { Box, CircularProgress } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './authContext'

/**
 * Route guard for the customer's own screens. Sends a signed-out visitor to
 * /login and brings them back here afterwards.
 */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const { pathname, search } = useLocation()

  if (loading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>
  }
  if (!session) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(pathname + search)}`} replace />
  }
  return <Outlet />
}
