import { Badge } from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import GridViewIcon from '@mui/icons-material/GridView'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import ReplayIcon from '@mui/icons-material/Replay'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCart } from '@/store/cartContext'

const TABS = [
  { to: '/',           label: 'Home',       icon: HomeOutlinedIcon, activeIcon: HomeIcon },
  { to: '/categories', label: 'Categories', icon: GridViewIcon,     activeIcon: GridViewIcon },
  { to: '/orders',     label: 'Orders',     icon: ReceiptLongIcon,  activeIcon: ReceiptLongIcon },
  { to: '/cart',       label: 'Cart',       icon: ShoppingCartIcon, activeIcon: ShoppingCartIcon },
  { to: '/reorder',    label: 'Reorder',    icon: ReplayIcon,       activeIcon: ReplayIcon },
]

/**
 * The floating glass tab bar: a frosted pill that hovers over whatever is
 * beneath it (the grid, a product sheet, the cart) the way an iOS tab bar
 * does. It sits above every sheet, so the tabs stay reachable with a
 * product open. The active bubble slides between tabs.
 */
export function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { count } = useCart()
  const activeIndex = TABS.findIndex((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))

  return (
    <nav className="glass-nav" aria-label="Main">
      <span className="glass-nav-bubble" style={{ transform: `translateX(${Math.max(0, activeIndex) * 100}%)`, opacity: activeIndex < 0 ? 0 : 1 }} aria-hidden="true" />
      {TABS.map((t, i) => {
        const active = i === activeIndex
        const Icon = active ? t.activeIcon : t.icon
        return (
          <button
            key={t.to}
            type="button"
            className={active ? 'is-active' : undefined}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(t.to)}
          >
            {t.to === '/cart' && count > 0 ? (
              <Badge badgeContent={count} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 15, minWidth: 15 } }}>
                <Icon sx={{ fontSize: 22 }} />
              </Badge>
            ) : (
              <Icon sx={{ fontSize: 22 }} />
            )}
            <span>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
