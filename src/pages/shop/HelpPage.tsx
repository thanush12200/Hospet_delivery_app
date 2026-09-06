import { Box, Button, Divider, Stack, Typography } from '@mui/material'
import CallIcon from '@mui/icons-material/Call'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { useSearchParams } from 'react-router-dom'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { telLink, waLink } from '@/lib/contact'
import { useCustomer } from '@/store/customerContext'
import { BRAND } from '@/theme/brand'

export default function HelpPage() {
  const { storeConfig } = useCustomer()
  const [params] = useSearchParams()
  const orderNo = params.get('order')
  const text = orderNo ? `Hi, I need help with order ${orderNo}` : `Hi, I need some help with ${BRAND.name}`

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#fff', pb: 'calc(58px + env(safe-area-inset-bottom) + 8px)' }}>
      <SubPageBar title="Help & support" />
      <Box sx={{ px: 2, pt: 2 }}>
        {storeConfig && !storeConfig.is_open && (
          <Box sx={{ p: 1.5, mb: 2, borderRadius: 2, bgcolor: '#FFF6E5', border: '1px solid #F4D48A' }}>
            <Typography variant="body2" fontWeight={700}>We're closed right now</Typography>
            <Typography variant="caption">{storeConfig.closed_message ?? 'Orders will open again soon.'}</Typography>
          </Box>
        )}

        <Typography variant="h6" gutterBottom>Talk to the store</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          A real person in Hospet, not a bot. {orderNo && `Mention order ${orderNo}.`}
        </Typography>
        <Stack spacing={1.25}>
          {storeConfig?.whatsapp && (
            <Button fullWidth size="large" variant="contained" startIcon={<WhatsAppIcon />}
              href={waLink(storeConfig.whatsapp, text)} target="_blank" rel="noopener"
              sx={{ bgcolor: '#25D366', '&:hover': { bgcolor: '#1DA851' } }}>
              WhatsApp us
            </Button>
          )}
          {storeConfig?.phone && (
            <Button fullWidth size="large" variant="outlined" startIcon={<CallIcon />}
              href={telLink(storeConfig.phone)}>
              Call {storeConfig.phone}
            </Button>
          )}
          {!storeConfig?.phone && !storeConfig?.whatsapp && (
            <Typography variant="body2" color="text.secondary">Contact details are being set up.</Typography>
          )}
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Common questions</Typography>
        <Faq q="How fast is delivery?" a="Around 45 minutes across Hospet. You see a live status the moment we accept, pack and send out your order." />
        <Faq q="Can I cancel?" a={`Yes, within ${storeConfig?.cancel_window_minutes ?? 5} minutes of placing the order, from the order screen. After that, message us and we will sort it out.`} />
        <Faq q="How do I pay?" a="Cash or UPI to the rider at your door. Online payment is coming." />
        <Faq q="What if something is missing or damaged?" a="Tell the rider, or message us with the order number. We fix it the same day." />

        <Divider sx={{ my: 3 }} />
        <Box id="about">
          <Box sx={{ maxWidth: 260, mx: 'auto', mb: 1.5 }}>
            <img src={BRAND.logo} alt={`${BRAND.name} logo`} style={{ width: '100%', height: 'auto', display: 'block' }} />
          </Box>
          <Typography variant="h6" gutterBottom>About {BRAND.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {BRAND.name} stands for {BRAND.expansion}. {BRAND.tagline}: everyday essentials at MRP, delivered in
            minutes across {BRAND.city} from our own store. No national app serves this town, so we built one.
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="body2" fontWeight={700}>{q}</Typography>
      <Typography variant="body2" color="text.secondary">{a}</Typography>
    </Box>
  )
}
