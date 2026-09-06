import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useAuth } from '@/auth/authContext'

export default function AdminLogin() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await signIn(email.trim(), password)
    if (error) setError(error)
    setBusy(false)
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
      <Paper sx={{ p: 3, width: '100%', maxWidth: 380, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main' }}>FAA</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>Staff sign in</Typography>

        <form onSubmit={onSubmit}>
          <Stack spacing={2} sx={{ mt: 2 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Email" type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} required fullWidth size="small"
            />
            <TextField
              label="Password" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} required fullWidth size="small"
            />
            <Button type="submit" variant="contained" disabled={busy} size="large">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  )
}
