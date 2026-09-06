import { Box } from '@mui/material'
import { BRAND } from '@/theme/brand'

/**
 * The scooter mark beside the FAA wordmark, cut from the logo at 2-3x so it
 * stays crisp on any phone. `height` is the wordmark's height; the mark is
 * sized to match its cap height.
 */
export function BrandLockup({
  height = 26, onClick, ariaLabel = `${BRAND.name} — ${BRAND.expansion}`,
}: {
  height?: number
  onClick?: () => void
  ariaLabel?: string
}) {
  const markH = Math.round(height * 1.55)
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      aria-label={ariaLabel}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 1,
        background: 'none', border: 0, p: 0, cursor: onClick ? 'pointer' : 'default',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <img
        src={BRAND.mark} alt=""
        height={markH} width={Math.round(markH * 920 / 630)}
        style={{ height: markH, width: 'auto', display: 'block' }}
        decoding="async"
      />
      <img
        src={BRAND.wordmark} alt={BRAND.name}
        height={height} width={Math.round(height * 950 / 300)}
        style={{ height, width: 'auto', display: 'block' }}
        decoding="async"
      />
    </Box>
  )
}
