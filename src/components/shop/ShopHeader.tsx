import { Box, IconButton, InputBase, Stack, Typography } from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import SearchIcon from '@mui/icons-material/Search'

/**
 * The brand header. Layout follows the convention Indian quick-commerce users
 * already know -- delivery promise, address, then search -- because that
 * familiarity is worth more than novelty. The identity is Wink's own.
 *
 * InputBase rather than TextField deliberately: TextField pulls ~23KB gzipped
 * into the shop bundle for what is a single search box.
 */
export function ShopHeader({
  query, onQueryChange, address, onAddressClick,
}: {
  query: string
  onQueryChange: (v: string) => void
  address: string
  onAddressClick?: () => void
}) {
  return (
    <Box
      sx={{
        background: 'linear-gradient(165deg, #0E8A62 0%, #0B6E4F 55%, #095B42 100%)',
        color: '#fff',
        px: 2,
        pt: 'calc(12px + env(safe-area-inset-top))',
        pb: 2,
        borderRadius: '0 0 20px 20px',
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ opacity: 0.85, letterSpacing: '0.04em' }}>
            WINK IN
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 28, lineHeight: 1.05, mt: -0.25 }}>
            45 minutes
          </Typography>
          <Stack
            direction="row" alignItems="center" spacing={0.25}
            onClick={onAddressClick}
            sx={{ mt: 0.25, cursor: onAddressClick ? 'pointer' : 'default', minWidth: 0 }}
          >
            <Typography variant="body2" noWrap sx={{ opacity: 0.95, maxWidth: 240 }}>
              {address}
            </Typography>
            <KeyboardArrowDownIcon sx={{ fontSize: 18, opacity: 0.9 }} />
          </Stack>
        </Box>

        <IconButton
          size="small"
          aria-label="Account"
          sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.26)' } }}
        >
          <PersonOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box
        sx={{
          mt: 1.75, display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: 'rgba(255,255,255,0.95)', borderRadius: 2.5, px: 1.5, py: 1,
        }}
      >
        <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
        <InputBase
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search for rice, dal, tea…"
          inputProps={{ 'aria-label': 'Search products' }}
          sx={{ flex: 1, fontSize: 14 }}
        />
      </Box>
    </Box>
  )
}
