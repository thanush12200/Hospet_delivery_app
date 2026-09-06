import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Divider, IconButton, MenuItem, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  addNotifyTarget, deleteNotifyTarget, listNotifyTargets, sendTestAlert, setNotifyTargetActive, type NotifyTarget,
} from '@/api/admin'

function suggestTopic(): string {
  const buf = new Uint8Array(5); crypto.getRandomValues(buf)
  return 'faa-orders-' + Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Where a new order is announced when nobody is watching the admin screen.
 * Rows live in notify_targets; the database sends the message itself the
 * moment an order is placed (migration 0022), so nothing here needs a
 * server or a browser tab to stay open.
 */
export function OrderAlerts() {
  const [targets, setTargets] = useState<NotifyTarget[]>([])
  const [kind, setKind] = useState<'ntfy' | 'telegram'>('ntfy')
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState(() => suggestTopic())
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setTargets(await listNotifyTargets()) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(null); setMsg(null)
    try { await work(); await refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  function add() {
    const t = target.trim()
    if (!t) { setError(kind === 'ntfy' ? 'Give the topic a name.' : 'Enter the chat id.'); return }
    if (kind === 'telegram' && !secret.trim()) { setError('Paste the bot token from BotFather.'); return }
    void run(async () => {
      await addNotifyTarget({ kind, label: label.trim() || null, target: t, secret: kind === 'telegram' ? secret.trim() : null })
      setLabel(''); setSecret(''); setTarget(kind === 'ntfy' ? suggestTopic() : '')
      setMsg('Added. Tap "Send test alert" to check it arrives.')
    })
  }

  function test() {
    void run(async () => {
      const r = await sendTestAlert()
      setMsg(!r.pg_net ? 'The database cannot send HTTP requests here (pg_net is not enabled). Run migration 0022 on Supabase.'
        : r.targets === 0 ? 'No active targets yet. Add one below.'
        : `Queued to ${r.sent} ${r.sent === 1 ? 'device' : 'devices'}. It should arrive within a few seconds.`)
    })
  }

  return (
    <Paper sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2">Order alerts on your phone</Typography>
          <Typography variant="caption" color="text.secondary">
            Every new order is pushed to these the moment it is placed, even with the admin screen closed.
          </Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={busy || targets.length === 0} onClick={test}>Send test alert</Button>
      </Stack>
      {msg && <Alert severity="info" sx={{ mb: 1.5 }} onClose={() => setMsg(null)}>{msg}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      {targets.length > 0 && (
        <Stack divider={<Divider />} sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          {targets.map((t) => (
            <Stack key={t.id} direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, opacity: t.is_active ? 1 : 0.55 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700}>
                  {t.kind === 'ntfy' ? 'ntfy' : 'Telegram'}{t.label ? ` · ${t.label}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                  {t.kind === 'ntfy' ? `topic ${t.target}` : `chat ${t.target} · bot ••••${(t.secret ?? '').slice(-4)}`}
                  {t.last_sent_at && ` · last sent ${new Date(t.last_sent_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}`}
                </Typography>
              </Box>
              <Switch size="small" checked={t.is_active} disabled={busy} onChange={() => void run(() => setNotifyTargetActive(t.id, !t.is_active))}
                inputProps={{ 'aria-label': 'Active' }} />
              <IconButton size="small" aria-label="Remove" disabled={busy} onClick={() => void run(() => deleteNotifyTarget(t.id))}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
        </Stack>
      )}

      <Stack spacing={1.5}>
        <TextField select size="small" label="Send to" value={kind} sx={{ width: 220 }}
          onChange={(e) => { const k = e.target.value as 'ntfy' | 'telegram'; setKind(k); setTarget(k === 'ntfy' ? suggestTopic() : '') }}>
          <MenuItem value="ntfy">ntfy app (simplest)</MenuItem>
          <MenuItem value="telegram">Telegram bot</MenuItem>
        </TextField>
        {kind === 'ntfy' ? (
          <>
            <Typography variant="caption" color="text.secondary">
              Install the free <strong>ntfy</strong> app (Android, iPhone), tap + and subscribe to this topic. The topic name is the
              only secret, so keep the random one.
            </Typography>
            <TextField size="small" label="Topic" value={target} onChange={(e) => setTarget(e.target.value)} inputProps={{ maxLength: 64 }} />
          </>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary">
              In Telegram, message <strong>@BotFather</strong>, send /newbot, and paste the token here. Then send your new bot any
              message, open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> in a browser, and copy the
              number after &quot;chat&quot;:&#123;&quot;id&quot;: as the chat id.
            </Typography>
            <TextField size="small" label="Bot token" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <TextField size="small" label="Chat id" value={target} onChange={(e) => setTarget(e.target.value)} />
          </>
        )}
        <TextField size="small" label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Owner's phone" sx={{ width: 260 }} />
        <Box><Button variant="contained" size="small" disabled={busy} onClick={add}>Add</Button></Box>
      </Stack>
    </Paper>
  )
}
