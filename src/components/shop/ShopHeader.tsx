import { Box, IconButton, InputBase, Stack, Typography } from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import SearchIcon from '@mui/icons-material/Search'
import { BrandLockup } from './BrandLockup'
import { BRAND_TINT } from '@/theme/brand'

/**
 * The brand header: the FAA lockup on white so the logo shows in its own
 * colours, the delivery promise and address under it, then search. Layout
 * follows the convention Indian quick-commerce users already know.
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
        bgcolor: '#fff', color: 'text.primary',
        px: 2, pt: 'calc(10px + env(safe-area-inset-top))', pb: 1.5,
        borderBottom: '1px solid', borderColor: 'divider',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <BrandLockup height={26} onClick={onBrandClick} />
        <IconButton
          size="small"
          aria-label="Account"
          onClick={onAccountClick}
          sx={{
            bgcolor: BRAND_TINT, color: 'primary.main', width: 38, height: 38,
            fontWeight: 800, fontSize: 15, border: '1px solid', borderColor: '#FBD5D3',
            '&:hover': { bgcolor: '#FFE4E2' },
          }}
        >
          {accountInitial ? accountInitial : <PersonOutlineIcon fontSize="small" />}
        </IconButton>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.25, minWidth: 0 }}>
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0,
          bgcolor: 'primary.main', color: '#fff', borderRadius: 1.5, px: 0.75, py: 0.25,
          fontSize: 12, fontWeight: 800, letterSpacing: '0.02em',
        }}>
          <BoltIcon sx={{ fontSize: 14 }} /> {promiseMinutes} min
        </Box>
        <Stack
          direction="row" alignItems="center" spacing={0.25}
          role={onAddressClick ? 'button' : undefined}
          tabIndex={onAddressClick ? 0 : undefined}
          onClick={onAddressClick}
          onKeyDown={(e) => { if (onAddressClick && e.key === 'Enter') onAddressClick() }}
          aria-label="Change delivery address"
          sx={{ cursor: onAddressClick ? 'pointer' : 'default', minWidth: 0, flex: 1 }}
        >
          <LocationOnIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          {addressHint && (
            <Typography variant="body2" sx={{ fontWeight: 700, flexShrink: 0 }}>{addressHint}</Typography>
          )}
          <Typography variant="body2" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
            {address}
          </Typography>
          <KeyboardArrowDownIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
        </Stack>
      </Stack>

      <Box
        role={onSearchFocus ? 'button' : undefined}
        onClick={onSearchFocus}
        sx={{
          mt: 1.25, display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: '#F3F4F6', borderRadius: 2.5, px: 1.5, py: 1,
          cursor: onSearchFocus ? 'pointer' : undefined,
        }}
      >
        <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
        <InputBase
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onSearchFocus}
          readOnly={!!onSearchFocus}
          placeholder="Search for rice, dal, tea…"
          inputProps={{ 'aria-label': 'Search products' }}
          sx={{ flex: 1, fontSize: 14 }}
        />
      </Box>
    </Box>
  )
}
