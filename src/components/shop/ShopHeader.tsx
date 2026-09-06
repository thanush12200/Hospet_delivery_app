import { useState } from 'react'
import { Box, Button, IconButton, InputBase } from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import SearchIcon from '@mui/icons-material/Search'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import { NavLink, useNavigate } from 'react-router-dom'
import { BrandLockup } from './BrandLockup'
import { BrandSheet } from './BrandSheet'
import { useTypedPlaceholder } from '@/hooks/useTypedPlaceholder'

const SEARCH_HINTS = ['rice', 'atta', 'toor dal', 'milk', 'tea', 'biscuits', 'soap', 'onion']
import { AddressChooserSheet } from './AddressChooserSheet'
import { useCustomer } from '@/store/customerContext'
import { useCart } from '@/store/cartContext'
import { addressLabel, addressLine } from '@/lib/address'
import { paiseToRupees } from '@/lib/money'
import { BRAND } from '@/theme/brand'

export function ShopHeader() {
  const customer = useCustomer()
  const cart = useCart()
  const navigate = useNavigate()
  const [chooser, setChooser] = useState(false)
  const [brand, setBrand] = useState(false)
  const [query, setQuery] = useState('')
  const placeholder = useTypedPlaceholder(SEARCH_HINTS, !query)
  const address = customer.defaultAddress
  const destination = address ? `${addressLabel(address)} - ${addressLine(address)}`
    : customer.activeZone ? `${customer.activeZone.name}, Hospet` : 'Select delivery area'

  return (
    <>
      <div className="store-notice"><LocalShippingOutlinedIcon />
        <span>Your neighbourhood store, delivered to your door.</span>
        <span className="notice-city">Made for Hospet</span>
      </div>
      <header className="shop-header">
        <div className="header-inner">
          <div className="header-brand"><BrandLockup height={25} onClick={() => setBrand(true)} /></div>
          <button className="delivery-location" onClick={() => setChooser(true)} aria-label="Change delivery address">
            <strong>{customer.storeConfig?.is_open === false ? 'Store is closed' : `Delivery in ${customer.activeZone?.sla_minutes ?? BRAND.promiseMinutes} minutes`}</strong>
            <span>{destination}<KeyboardArrowDownIcon /></span>
          </button>
          <Box component="form" className="header-search" onSubmit={(e) => {
            e.preventDefault(); navigate(`/search?q=${encodeURIComponent(query.trim())}`)
          }}>
            <SearchIcon />
            <InputBase value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder} inputProps={{ 'aria-label': 'Search products' }} />
            <IconButton type="submit" size="small" aria-label="Search" title="Search products"><SearchIcon fontSize="small" /></IconButton>
          </Box>
          <IconButton className="header-account" aria-label="Account" title="Your account"
            onClick={() => navigate('/account')}><PersonOutlineIcon /></IconButton>
          <Button className="header-cart" color="success" variant="contained" startIcon={<ShoppingBagOutlinedIcon />}
            onClick={() => navigate('/cart')}>
            {cart.count > 0 ? `${cart.count} items - ${paiseToRupees(cart.subtotalPaise)}` : 'My basket'}
          </Button>
        </div>
        <nav className="desktop-nav" aria-label="Main navigation">
          <div className="desktop-nav-inner">
            <NavLink to="/" end>Shop</NavLink><NavLink to="/categories">All categories</NavLink>
            <NavLink to="/orders">My orders</NavLink><NavLink to="/help">Help & support</NavLink>
            <span>Everyday essentials. Always at MRP.</span>
          </div>
        </nav>
      </header>
      <AddressChooserSheet open={chooser} onClose={() => setChooser(false)} returnTo="/" />
      <BrandSheet open={brand} onClose={() => setBrand(false)} />
    </>
  )
}
