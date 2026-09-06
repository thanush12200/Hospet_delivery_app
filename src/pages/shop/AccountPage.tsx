import { useState } from 'react'
import {
  Alert, Box, Button, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PersonIcon from '@mui/icons-material/Person'
import ShoppingBasketOutlinedIcon from '@mui/icons-material/ShoppingBasketOutlined'
import LocationOnOutlinedIcon from '@mui/icons-material/LocationOnOutlined'
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined'
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined'
import PhoneIphoneOutlinedIcon from '@mui/icons-material/PhoneIphoneOutlined'
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/authContext'
import { BrandSheet } from '@/components/shop/BrandSheet'
import { addressLine } from '@/lib/address'
import { formatIndianMobile } from '@/lib/phone'
import { useCustomer } from '@/store/customerContext'
import { BRAND } from '@/theme/brand'

const CARD = { bgcolor: '#fff', borderRadius: 3, boxShadow: '0 1px 2px rgba(20,24,31,0.05), 0 6px 16px rgba(20,24,31,0.06)' }

/**
 * The customer's own page, in the shape quick-commerce users expect: a soft
 * header with a large avatar, name and number; three quick actions; then
 * grouped rows. Only things FAA actually does are listed.
 */
export default function AccountPage() {
  const { signOut } = useAuth()
  const customer = useCustomer()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [about, setAbout] = useState(false)

  const p = customer.profile
  const initial = p?.name?.trim()[0]?.toUpperCase() ?? null

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
    <Box sx={{ pb: 'calc(58px + env(safe-area-inset-bottom) + 16px)', minHeight: '100dvh', bgcolor: '#F4F5F7' }}>
      {/* soft brand header */}
      <Box sx={{
        background: 'linear-gradient(180deg, #FFE1DE 0%, #FFF3F1 55%, #F4F5F7 100%)',
        px: 2, pt: 'calc(12px + env(safe-area-inset-top))', pb: 2, textAlign: 'center',
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <IconButton aria-label="Back" onClick={() => navigate('/')}
            sx={{ bgcolor: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', '&:hover': { bgcolor: '#fff' } }}>
            <ArrowBackIcon />
          </IconButton>
        </Box>
        <Box sx={{
          width: 104, height: 104, borderRadius: '50%', bgcolor: '#fff', mx: 'auto', mt: 0.5,
          display: 'grid', placeItems: 'center', boxShadow: '0 6px 18px rgba(229,35,31,0.15)',
          color: 'primary.main', fontWeight: 900, fontSize: 40,
        }}>
          {initial ?? <PersonIcon sx={{ fontSize: 56, color: '#14181F' }} />}
        </Box>

        {editing ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, maxWidth: 360, mx: 'auto' }}>
            <TextField size="small" value={name} autoFocus placeholder="Your name" fullWidth
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveName() }}
              inputProps={{ maxLength: 80 }} sx={{ bgcolor: '#fff', borderRadius: 1.5 }} />
            <Button size="small" variant="contained" disabled={busy || !name.trim()} onClick={() => void saveName()}>Save</Button>
            <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
          </Stack>
        ) : (
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 1.5 }}>
            <Typography sx={{ fontWeight: 900, fontSize: 24, lineHeight: 1.1 }} noWrap>
              {p?.name || 'Add your name'}
            </Typography>
            <IconButton size="small" aria-label="Edit name" onClick={() => { setName(p?.name ?? ''); setEditing(true) }}>
              <EditOutlinedIcon fontSize="small" />
            </IconButton>
          </Stack>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {p ? `${formatIndianMobile(p.phone)} · ${BRAND.city}` : 'Not a customer account'}
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 1.5, textAlign: 'left' }} onClose={() => setError(null)}>{error}</Alert>}
      </Box>

      <Box sx={{ px: 2 }}>
        {/* quick actions */}
        <Stack direction="row" spacing={1.25} sx={{ mt: -0.5 }}>
          <Tile icon={<ShoppingBasketOutlinedIcon />} label="Your orders" onClick={() => navigate('/orders')} />
          <Tile icon={<LocationOnOutlinedIcon />} label="Addresses" onClick={() => navigate('/account/addresses')} />
          <Tile icon={<SupportAgentOutlinedIcon />} label="Need help?" onClick={() => navigate('/help')} />
        </Stack>

        {/* promise strip */}
        <Box sx={{ ...CARD, mt: 2, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: '#FFF2F1', display: 'grid', placeItems: 'center', color: 'primary.main' }}>
            <BoltOutlinedIcon />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={800}>
              Delivery in {customer.activeZone?.sla_minutes ?? BRAND.promiseMinutes} minutes
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {customer.defaultAddress ? `To ${addressLine(customer.defaultAddress)}` : `Across ${BRAND.city}. Add an address to see your area.`}
            </Typography>
          </Box>
        </Box>

        <Typography sx={{ fontWeight: 800, fontSize: 15, mt: 3, mb: 1 }}>Your information</Typography>
        <Box sx={CARD}>
          <Row icon={<MenuBookOutlinedIcon />} title="Address book"
            subtitle={customer.addresses.length ? `${customer.addresses.length} saved` : 'Add where we should deliver'}
            onClick={() => navigate('/account/addresses')} />
          <Divider />
          <Row icon={<PhoneIphoneOutlinedIcon />} title="Mobile number"
            subtitle={p ? `+91 ${formatIndianMobile(p.phone)} · used to sign in and for the rider to call` : '—'} />
        </Box>

        <Typography sx={{ fontWeight: 800, fontSize: 15, mt: 3, mb: 1 }}>About</Typography>
        <Box sx={CARD}>
          <Row icon={<InfoOutlinedIcon />} title={`About ${BRAND.name}`} subtitle={`${BRAND.expansion} · ${BRAND.tagline}`}
            onClick={() => setAbout(true)} />
          <Divider />
          <Row icon={<SupportAgentOutlinedIcon />} title="Help & support"
            subtitle={customer.storeConfig?.phone ? `Call or WhatsApp ${customer.storeConfig.phone}` : 'Talk to the store'}
            onClick={() => navigate('/help')} />
        </Box>

        <Button fullWidth variant="outlined" color="inherit" startIcon={<LogoutIcon />}
          sx={{ mt: 3, bgcolor: '#fff' }} onClick={() => void leave()}>
          Sign out
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}>
          Your cart stays on this phone after you sign out.
        </Typography>
      </Box>

      <BrandSheet open={about} onClose={() => setAbout(false)} />
    </Box>
  )
}

function Tile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Box
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      sx={{
        ...CARD, flex: 1, py: 1.75, px: 1, textAlign: 'center', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75,
        '&:active': { transform: 'scale(0.98)' },
      }}
    >
      <Box sx={{ width: 40, height: 40, borderRadius: '50%', bgcolor: '#FFF2F1', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
        {icon}
      </Box>
      <Typography variant="body2" fontWeight={700} sx={{ fontSize: 12.5 }}>{label}</Typography>
    </Box>
  )
}

function Row({ icon, title, subtitle, onClick }: {
  icon: React.ReactNode; title: string; subtitle?: string; onClick?: () => void
}) {
  return (
    <Box
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={(e) => { if (onClick && e.key === 'Enter') onClick() }}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, cursor: onClick ? 'pointer' : 'default',
            '&:active': onClick ? { bgcolor: '#F7F8FA' } : undefined }}
    >
      <Box sx={{ color: 'text.secondary', display: 'grid', placeItems: 'center' }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700}>{title}</Typography>
        {subtitle && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{subtitle}</Typography>}
      </Box>
      {onClick && <ChevronRightIcon sx={{ color: 'text.secondary' }} />}
    </Box>
  )
}
