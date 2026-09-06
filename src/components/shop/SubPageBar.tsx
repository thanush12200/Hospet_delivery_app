import { type ReactNode } from 'react'
import { AppBar, IconButton, Toolbar, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useNavigate } from 'react-router-dom'

/** Top bar for screens below the tab bar's roots: back arrow + title. */
export function SubPageBar({ title, backTo, action }: { title: string; backTo?: string; action?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <AppBar position="sticky" color="inherit" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Toolbar>
        <IconButton edge="start" aria-label="Back" onClick={() => (backTo ? navigate(backTo) : navigate(-1))}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" sx={{ flex: 1 }}>{title}</Typography>
        {action}
      </Toolbar>
    </AppBar>
  )
}
