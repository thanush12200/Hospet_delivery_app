import { useState } from 'react'
import {
  Alert, Box, Button, Chip, IconButton, Stack, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useNavigate } from 'react-router-dom'
import { deleteMyAddress, setDefaultAddress } from '@/api/customer'
import { SubPageBar } from '@/components/shop/SubPageBar'
import { LABELS, addressLine } from '@/lib/address'
import { useCustomer } from '@/store/customerContext'

export default function AddressesPage() {
  const customer = useCustomer()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id); setError(null)
    try { await fn(); await customer.refresh() }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(null); setConfirm(null) }
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: '#F7F8FA', pb: 12 }}>
      <SubPageBar title="Saved addresses" backTo="/account" />

      <Box sx={{ px: 2, pt: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        {customer.addresses.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 40, mb: 1 }}>📍</Typography>
            <Typography variant="h6" gutterBottom>No addresses yet</Typography>
            <Typography variant="body2" color="text.secondary">
              Add one and checkout becomes a single tap.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.25}>
            {customer.addresses.map((a) => {
              const label = LABELS.find((l) => l.value === a.label)
              const zone = customer.zones.find((z) => z.id === a.zone_id)
              return (
                <Box key={a.id} sx={{
                  bgcolor: '#fff', borderRadius: 3, p: 1.75, border: '1.5px solid',
                  borderColor: a.is_default ? 'primary.main' : 'divider',
                }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography sx={{ fontSize: 18 }} aria-hidden>{label?.icon}</Typography>
                    <Typography variant="body2" fontWeight={800}>{label?.text}</Typography>
                    {a.is_default && <Chip size="small" color="primary" label="Default" sx={{ height: 20, fontSize: 10.5 }} />}
                    <Box sx={{ flex: 1 }} />
                    <IconButton size="small" aria-label="Edit" onClick={() => navigate(`/account/addresses/${a.id}`)}>
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" aria-label="Delete" disabled={busy === a.id}
                      onClick={() => setConfirm(confirm === a.id ? null : a.id)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.75 }}>{addressLine(a)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {zone?.name ?? 'Area'}{a.lat != null ? ' · pinned on map' : ''}
                  </Typography>

                  {confirm === a.id && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                      <Button size="small" color="error" variant="contained" disabled={busy === a.id}
                        onClick={() => void run(a.id, () => deleteMyAddress(a.id))}>
                        Remove this address
                      </Button>
                      <Button size="small" onClick={() => setConfirm(null)}>Keep</Button>
                    </Stack>
                  )}
                  {!a.is_default && confirm !== a.id && (
                    <Button size="small" sx={{ mt: 0.75, ml: -0.75 }} disabled={busy === a.id}
                      onClick={() => void run(a.id, () => setDefaultAddress(a.id))}>
                      Deliver here by default
                    </Button>
                  )}
                </Box>
              )
            })}
          </Stack>
        )}
      </Box>

      <Box className="flow-action" sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))',
                 bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider' }}>
        <Button fullWidth size="large" variant="contained" startIcon={<AddIcon />}
          onClick={() => navigate('/account/addresses/new')}>
          Add a new address
        </Button>
      </Box>
    </Box>
  )
}
