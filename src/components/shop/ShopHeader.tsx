import { Box, IconButton, InputBase, Stack, Typography } from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import SearchIcon from '@mui/icons-material/Search'
import { BrandLockup } from './BrandLockup'
import { BRAND_GRADIENT, HEADER_SHADOW } from '@/theme/brand'

/**
 * The brand header: a red block with the FAA lockup on a white plate (the
 * logo is black-and-red on white, so it never sits directly on the red),
 * the delivery promise, the address, then search. Layout follows the
 * convention Indian quick-commerce users already know.
 *
 * InputBase rather than TextField deliberately: TextField pulls ~23KB gzipped
 * into the shop bundle for what is a single search box.
 */
export function ShopHeader({
  query, onQueryChange, onSearchFocus, address, addressHint, onAddressClick, onAccountClick, onBrandClick,
  accountInitial, promiseMinutes = 45,
}: {
  query: string
  onQueryChange: (v: string) => void
  /** When given, the box acts as a button to a search screen instead of an input. */
  onSearchFocus?: () => void
  address: string
  /** Small bold prefix before the address, e.g. "Home ·". */
  addressHint?: string
  onAddressClick?: () => void
  onAccountClick?: () => void
  /** Tapping the logo. */
  onBrandClick?: () => void
  /** Initial shown in the account button when signed in. */
  accountInitial?: string | null
  promiseMinutes?: number
}) {
  return (
    <Box
      sx={{
        background: BRAND_GRADIENT, color: '#fff',
        px: 2, pt: 'calc(10px + env(safe-area-inset-top))', pb: 2.25,
        borderRadius: '0 0 24px 24px',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box sx={{ bgcolor: '#fff', borderRadius: 3, px: 1.25, py: 0.75, boxShadow: HEADER_SHADOW, display: 'inline-flex' }}>
          <BrandLockup height={22} onClick={onBrandClick} />
        </Box>
        <IconButton
          size="small"
          aria-label="Account"
          onClick={onAccountClick}
          sx={{
            bgcolor: '#fff', color: 'primary.main', width: 40, height: 40,
            fontWeight: 800, fontSize: 15, boxShadow: HEADER_SHADOW,
            '&:hover': { bgcolor: '#FFF2F1' },
          }}
        >
          {accountInitial ? accountInitial : <PersonOutlineIcon fontSize="small" />}
        </IconButton>
      </Stack>

      <Typography sx={{ mt: 1.75, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.9 }}>
        DELIVERY IN
      </Typography>
      <Typography sx={{ fontWeight: 900, fontSize: 30, lineHeight: 1.05, letterSpacing: '-0.01em' }}>
        {promiseMinutes} minutes
      </Typography>

      <Stack
        direction="row" alignItems="center" spacing={0.5}
        role={onAddressClick ? 'button' : undefined}
        tabIndex={onAddressClick ? 0 : undefined}
        onClick={onAddressClick}
        onKeyDown={(e) => { if (onAddressClick && e.key === 'Enter') onAddressClick() }}
        aria-label="Change delivery address"
        sx={{
          mt: 1, minWidth: 0, cursor: onAddressClick ? 'pointer' : 'default',
          display: 'inline-flex', maxWidth: '100%',
          bgcolor: 'rgba(255,255,255,0.16)', borderRadius: 2, px: 1, py: 0.5,
        }}
      >
        <LocationOnIcon sx={{ fontSize: 16, flexShrink: 0 }} />
        {addressHint && (
          <Typography variant="body2" sx={{ fontWeight: 800, flexShrink: 0 }}>{addressHint}</Typography>
        )}
        <Typography variant="body2" noWrap sx={{ minWidth: 0, opacity: 0.95 }}>
          {address}
        </Typography>
        <KeyboardArrowDownIcon sx={{ fontSize: 18, flexShrink: 0, opacity: 0.9 }} />
      </Stack>

      <Box
        role={onSearchFocus ? 'button' : undefined}
        onClick={onSearchFocus}
        sx={{
          mt: 1.5, display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: '#fff', borderRadius: 3, px: 1.5, py: 1.1, boxShadow: HEADER_SHADOW,
          cursor: onSearchFocus ? 'pointer' : undefined,
        }}
      >
        <SearchIcon sx={{ color: 'primary.main', fontSize: 22 }} />
        <InputBase
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onSearchFocus}
          readOnly={!!onSearchFocus}
          placeholder="Search for rice, dal, tea…"
          inputProps={{ 'aria-label': 'Search products' }}
          sx={{ flex: 1, fontSize: 14.5, color: 'text.primary' }}
        />
      </Box>
    </Box>
  )
}
