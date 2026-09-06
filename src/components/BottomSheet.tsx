import { useEffect, type ReactNode } from 'react'
import { Box, Slide, Typography } from '@mui/material'

/**
 * A mobile bottom sheet on the Slide transition the shop already bundles.
 * MUI's Drawer would pull Modal, Backdrop and the focus trap (~9 KB gzipped)
 * into the customer route for the same effect.
 *
 * Closes on backdrop tap and on Escape. The page underneath stays mounted.
 */
export function BottomSheet({
  open, onClose, title, children, maxHeight = '85dvh',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  maxHeight?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  return (
    <>
      {open && (
        <Box
          onClick={onClose}
          sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(20,24,31,0.45)', zIndex: 1300 }}
          aria-hidden
        />
      )}
      <Slide direction="up" in={open} mountOnEnter unmountOnExit>
        <Box
          role="dialog"
          aria-modal="true"
          aria-label={title}
          sx={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1301,
            bgcolor: '#fff', borderRadius: '20px 20px 0 0',
            maxHeight, display: 'flex', flexDirection: 'column',
            pb: 'env(safe-area-inset-bottom)',
            boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
          }}
        >
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: '#D9DDE3', mx: 'auto', mt: 1.25 }} />
          {title && (
            <Typography sx={{ fontWeight: 800, fontSize: 16, px: 2, pt: 1.5, pb: 1 }}>{title}</Typography>
          )}
          <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>{children}</Box>
        </Box>
      </Slide>
    </>
  )
}
