import { createTheme } from '@mui/material/styles'
import { BRAND, PAGE_BG } from './brand'

/**
 * Palette lifted from the FAA logo: the scooter red as primary, near-black
 * ink for text and the secondary button, green kept only for semantic
 * "success" states (delivered, paid) where red would read as an error;
 * every accent in the storefront is the brand red.
 */
export const theme = createTheme({
  palette: {
    primary:   { main: BRAND.red, dark: BRAND.redDark, light: '#FF6A61', contrastText: '#fff' },
    secondary: { main: BRAND.ink, contrastText: '#fff' },
    success:   { main: '#16734B', dark: '#105B3B', contrastText: '#fff' },
    warning:   { main: '#E8930C' },
    background:{ default: PAGE_BG, paper: '#FFFFFF' },
    text:      { primary: BRAND.ink, secondary: '#68706B' },
    divider:   '#E7EBE7',
  },
  shape: { borderRadius: 8 },
  typography: {
    // System fonts on purpose: a webfont request on patchy 4G delays first
    // paint for a face the customer will not notice.
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Kannada", sans-serif',
    allVariants: { letterSpacing: 0 },
    h6:   { fontWeight: 750, fontSize: '1.125rem' },
    body2:{ fontSize: '0.875rem' },
    button: { textTransform: 'none', fontWeight: 700, letterSpacing: 0 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 6, minHeight: 36 } } },
    MuiPaper:  { defaultProps: { elevation: 0 } },
    MuiCssBaseline: { styleOverrides: { ':focus-visible': { outline: '3px solid #E5231F', outlineOffset: 3 }, 'html': { scrollBehavior: 'smooth' }, 'body': { letterSpacing: 0 }, '@media (prefers-reduced-motion: reduce)': { 'html': { scrollBehavior: 'auto' }, '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } } } },
  },
})
