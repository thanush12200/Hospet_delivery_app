import { Box, Button, CircularProgress, Typography } from '@mui/material'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import MapOutlinedIcon from '@mui/icons-material/MapOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { BrandLockup } from '@/components/shop/BrandLockup'
import AdminLogin from './AdminLogin'

const TABS = [
  { to: '/admin', label: 'Orders', icon: ReceiptLongOutlinedIcon },
  { to: '/admin/history', label: 'History', icon: HistoryOutlinedIcon },
  { to: '/admin/new', label: 'New order', icon: AddCircleOutlineIcon },
  { to: '/admin/catalogue', label: 'Catalogue', icon: StorefrontOutlinedIcon },
  { to: '/admin/categories', label: 'Categories', icon: CategoryOutlinedIcon },
  { to: '/admin/inventory', label: 'Inventory', icon: Inventory2OutlinedIcon },
  { to: '/admin/import', label: 'Import catalogue', icon: FileUploadOutlinedIcon },
  { to: '/admin/riders', label: 'Delivery partners', icon: LocalShippingOutlinedIcon },
  { to: '/admin/zones', label: 'Delivery areas', icon: MapOutlinedIcon },
  { to: '/admin/settings', label: 'Store settings', icon: SettingsOutlinedIcon },
]

export default function AdminLayout() {
  const { session, adminRole, loading, signOut } = useAuth()
  const { pathname } = useLocation()
  if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}><CircularProgress /></Box>
  if (!session) return <AdminLogin />
  if (!adminRole) return <Box className="empty-state"><Typography variant="h6" gutterBottom>This account is not staff</Typography>
    <Typography variant="body2" sx={{ mb: 2 }}>Ask the store owner to give this account staff access.</Typography>
    <Button variant="outlined" onClick={() => void signOut()}>Sign out</Button></Box>

  const current = TABS.find((t) => t.to === pathname)?.label ?? 'Order details'
  return <div className="admin-shell">
    <aside className="admin-sidebar"><div className="admin-brand"><BrandLockup height={23} /><span>STORE OPERATIONS</span></div>
      <nav aria-label="Store operations">{TABS.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/admin'}><Icon /><span>{label}</span></NavLink>)}</nav>
      <div className="admin-sidebar-bottom"><Button component={Link} to="/" startIcon={<StorefrontOutlinedIcon />} color="inherit">Open storefront</Button>
        <Button startIcon={<LogoutIcon />} color="inherit" onClick={() => void signOut()}>Sign out</Button></div>
    </aside>
    <div className="admin-workspace"><header className="admin-topbar"><span>Hospet store <span>/</span> <strong>{current}</strong></span><span className="staff-role">{adminRole === 'OWNER' ? 'Store owner' : 'Staff'}</span></header>
      <main className="admin-content"><Outlet /></main></div>
  </div>
}
