import { useState } from 'react'
import {
  Alert, Box, Button, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { formatIndianMobile } from '@/lib/phone'
import { useCustomer } from '@/store/customerContext'
import { addressLine } from '@/lib/address'

export default function AccountPage() {
  const { signOut } = useAuth()
  const customer = useCustomer()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const p = customer.profile
  const initial = (p?.name?.trim()[0] ?? p?.phone.slice(-2) ?? '?').toUpperCase()

  async function saveName() {
    setBusy(true); setError(null)
    try { await customer.updateName(name); setEditing(false) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function leave() {
    await signOut()
    await customer.refresh()
    navigate('/', { replace: true })
  }

  return (
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)', minHeight: '100dvh', bgcolor: '#F7F8FA' }}>
      <Box sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 100%)', color: '#fff',
        px: 2, pt: 'calc(20px + env(safe-area-inset-top))', pb: 3, borderRadius: '0 0 20px 20px',
      }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{
            width: 56, height: 56, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.2)',
            display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 24,
          }}>
            {initial}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small" value={name} autoFocus placeholder="Your name"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveName() }}
                  inputProps={{ maxLength: 80 }}
                  sx={{ bgcolor: '#fff', borderRadius: 1.5, flex: 1 }}
                />
                <Button size="small" variant="contained" color="secondary" disabled={busy || !name.trim()}
                  onClick={() => void saveName()}>Save</Button>
                <Button size="small" sx={{ color: '#fff' }} onClick={() => setEditing(false)}>Cancel</Button>
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography sx={{ fontWeight: 800, fontSize: 20 }} noWrap>
                  {p?.name || 'Add your name'}
                </Typography>
                <IconButton size="small" aria-label="Edit name" sx={{ color: '#fff' }}
                  onClick={() => { setName(p?.name ?? ''); setEditing(true) }}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {p ? `+91 ${formatIndianMobile(p.phone)}` : 'Not a customer account'}
            </Typography>
          </Box>
        </Stack>
        {error && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}
      </Box>

      <Box sx={{ px: 2, pt: 2 }}>
        <Box sx={{ bgcolor: '#fff', borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
          <Row
            icon={<LocationOnOutlinedIcon />} title="Saved addresses"
            subtitle={customer.defaultAddress ? addressLine(customer.defaultAddress) : 'Add where we should deliver'}
            onClick={() => navigate('/account/addresses')}
          />
          <Divider />
          <Row icon={<ReceiptLongOutlinedIcon />} title="Your orders" subtitle="Track, reorder, get help"
            onClick={() => navigate('/orders')} />
          <Divider />
          <Row icon={<HelpOutlineIcon />} title="Help & support"
            subtitle={customer.storeConfig?.phone ? `Call or WhatsApp ${customer.storeConfig.phone}` : 'Talk to the store'}
            onClick={() => navigate('/help')} />
          <Divider />
          <Row icon={<InfoOutlinedIcon />} title="About Wink" subtitle="Groceries across Hospet in 45 minutes"
            onClick={() => navigate('/help#about')} />
        </Box>

        <Button
          fullWidth variant="outlined" color="inherit" startIcon={<LogoutIcon />}
          sx={{ mt: 2, bgcolor: '#fff' }} onClick={() => void leave()}
        >
          Sign out
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 2 }}>
          Your cart stays on this phone after you sign out.
        </Typography>
      </Box>

    </Box>
  )
}

function Row({ icon, title, subtitle, onClick }: {
  icon: React.ReactNode; title: string; subtitle?: string; onClick: () => void
}) {
  return (
    <Box
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, cursor: 'pointer',
            '&:active': { bgcolor: '#F7F8FA' } }}
    >
      <Box sx={{ color: 'primary.main', display: 'grid', placeItems: 'center' }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{subtitle}</Typography>}
      </Box>
      <ChevronRightIcon sx={{ color: 'text.secondary' }} />
    </Box>
  )
}
