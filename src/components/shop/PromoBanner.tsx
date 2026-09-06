import { Button } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined'
import { paiseToRupees } from '@/lib/money'
import { BRAND } from '@/theme/brand'

export function PromoBanner({ freeAbovePaise, zoneName, minutes = BRAND.promiseMinutes }: {
  freeAbovePaise: number | null; zoneName?: string; minutes?: number
}) {
  return (
    <>
      <section className="grocery-banner" aria-labelledby="grocery-heading">
        <div className="banner-copy">
          <span className="eyebrow"><span className="status-dot" /> YOUR HOSPET STORE</span>
          <h1 id="grocery-heading">Your daily groceries.<br /><span>Delivered.</span></h1>
          <p>From the first chai to the last-minute essentials.<br className="desktop-break" /> Your daily shop, delivered in about {minutes} minutes.</p>
          <Button variant="contained" color="success" endIcon={<ArrowForwardIcon />}
            onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Shop essentials
          </Button>
        </div>
        <div className="banner-stamp"><strong>{minutes}</strong><span>MINUTES</span><small>from store to door</small></div>
      </section>
      <div className="shop-promises">
        <span><LocalShippingOutlinedIcon />{freeAbovePaise != null ? `Free delivery over ${paiseToRupees(freeAbovePaise)}${zoneName ? ` in ${zoneName}` : ''}` : 'Delivered from our Hospet store'}</span>
        <span><VerifiedOutlinedIcon />No hidden charges</span>
        <span><PaymentsOutlinedIcon />Cash or UPI at your door</span>
      </div>
    </>
  )
}
