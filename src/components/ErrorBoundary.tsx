import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'

const RELOAD_FLAG = 'wink.reloaded-once'

/**
 * One render error used to white-screen the whole app. Two cases matter:
 *
 *  - A stale chunk after a deploy ("Failed to fetch dynamically imported
 *    module"): the fix is a reload, so do it once automatically.
 *  - Anything else: say so and offer a way back to the shop.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stale = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i
      .test(error.message)
    let reloaded = false
    try { reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1' } catch { /* ignore */ }
    if (stale && !reloaded) {
      try { sessionStorage.setItem(RELOAD_FLAG, '1') } catch { /* ignore */ }
      window.location.reload()
      return
    }
    console.error('Wink crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: 40, mb: 1 }}>😵</Typography>
          <Typography variant="h6" gutterBottom>Something went wrong</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your cart is safe. Try going back to the shop.
          </Typography>
          <Button
            variant="contained"
            onClick={() => {
              try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* ignore */ }
              window.location.assign('/')
            }}
          >
            Back to shop
          </Button>
        </Box>
      </Box>
    )
  }
}
