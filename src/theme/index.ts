import { createTheme } from '@mui/material/styles'
import { BRAND } from './brand'

/**
 * Palette lifted from the FAA logo: the scooter red as primary, near-black
 * ink for text and the secondary button, green kept only for "success"
 * states (delivered, paid) where red would read as an error.
 */
export const theme = createTheme({
  palette: {
    primary:   { main: BRAND.red, dark: BRAND.redDark, light: '#FF6A61', contrastText: '#fff' },
    secondary: { main: BRAND.ink, contrastText: '#fff' },
    success:   { main: '#1B8A4C' },
    warning:   { main: '#E8930C' },
    background:{ default: '#FFFFFF', paper: '#FFFFFF' },
    text:      { primary: BRAND.ink, secondary: '#5B6472' },
    divider:   '#EDEFF3',
  },
  shape: { borderRadius: 12 },
  typography: {
    // System fonts on purpose: a webfont request on patchy 4G delays first
    // paint for a face the customer will not notice.
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Kannada", sans-serif',
    h6:   { fontWeight: 700, fontSize: '1rem' },
    body2:{ fontSize: '0.8125rem' },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper:  { defaultProps: { elevation: 0 } },
  },
})
