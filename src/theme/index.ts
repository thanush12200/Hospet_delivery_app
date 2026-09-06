import { createTheme } from '@mui/material/styles'

/**
 * Deliberately not a clone of any existing brand. The layout follows the
 * conventions Indian quick-commerce users already know (category rail, product
 * grid, stepper buttons, sticky cart bar) because familiarity reduces friction,
 * but the identity is our own.
 */
export const theme = createTheme({
  palette: {
    primary:   { main: '#0B6E4F', dark: '#08543C', light: '#2E9B77' },
    secondary: { main: '#F4B400' },
    success:   { main: '#0B6E4F' },
    background:{ default: '#FFFFFF', paper: '#FFFFFF' },
    text:      { primary: '#14181F', secondary: '#5B6472' },
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
