import { Badge, Box, Paper, Stack, Typography } from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import GridViewIcon from '@mui/icons-material/GridView'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '@/store/cartContext'

const TABS = [
  { to: '/',           label: 'Home',       icon: HomeOutlinedIcon, activeIcon: HomeIcon },
  { to: '/categories', label: 'Categories', icon: GridViewIcon,     activeIcon: GridViewIcon },
  { to: '/orders',     label: 'Orders',     icon: ReceiptLongIcon,  activeIcon: ReceiptLongIcon },
  { to: '/cart',       label: 'Cart',       icon: ShoppingCartIcon, activeIcon: ShoppingCartIcon },
]

/** Fixed tab bar. Makes the PWA feel like an installed app rather than a page. */
export function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { count } = useCart()

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1100,
        borderTop: '1px solid', borderColor: 'divider', bgcolor: '#fff',
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <Stack direction="row" sx={{ height: 58 }}>
        {TABS.map((t) => {
          const active = pathname === t.to
          const Icon = active ? t.activeIcon : t.icon
          return (
            <Box
              key={t.to}
              onClick={() => navigate(t.to)}
              sx={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 0.25,
                cursor: 'pointer', color: active ? 'primary.main' : 'text.secondary',
              }}
            >
              {t.to === '/cart' && count > 0 ? (
                <Badge badgeContent={count} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 15, minWidth: 15 } }}>
                  <Icon sx={{ fontSize: 22 }} />
                </Badge>
              ) : (
                <Icon sx={{ fontSize: 22 }} />
              )}
              <Typography sx={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>
                {t.label}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )
}
