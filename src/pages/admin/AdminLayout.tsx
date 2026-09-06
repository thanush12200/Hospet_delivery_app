import { AppBar, Box, Button, CircularProgress, Container, Stack, Toolbar, Typography } from '@mui/material'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import AdminLogin from './AdminLogin'

const TABS = [
  { to: '/admin',           label: 'Orders' },
  { to: '/admin/new',       label: 'New order' },
  { to: '/admin/catalogue', label: 'Catalogue' },
  { to: '/admin/inventory', label: 'Stock' },
  { to: '/admin/riders',    label: 'Riders' },
  { to: '/admin/zones',     label: 'Areas' },
]

export default function AdminLayout() {
  const { session, adminRole, loading, signOut } = useAuth()
  const { pathname } = useLocation()

  if (loading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>
  }
  if (!session) return <AdminLogin />

  // Signed in, but not staff. The database would refuse every admin call
  // anyway; this just explains why rather than showing a broken screen.
  if (!adminRole) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 3, textAlign: 'center' }}>
        <Box>
          <Typography variant="h6" gutterBottom>This account is not staff</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Signed in as {session.user.email}, but there is no matching row in <code>admin_users</code>.
          </Typography>
          <Button onClick={() => void signOut()} variant="outlined">Sign out</Button>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#FAFBFC' }}>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, color: 'primary.main' }}>FAA</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 2 }}>admin</Typography>
          <Stack direction="row" spacing={0.5} sx={{ flex: 1 }}>
            {TABS.map((t) => (
              <Button
                key={t.to} component={Link} to={t.to} size="small"
                variant={pathname === t.to ? 'contained' : 'text'}
              >
                {t.label}
              </Button>
            ))}
          </Stack>
          <Button size="small" onClick={() => void signOut()}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth={false} sx={{ py: 2 }}>
        <Outlet />
      </Container>
    </Box>
  )
}
