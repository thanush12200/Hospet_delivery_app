import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Snackbar } from '@mui/material'
import { ToastContext } from './toastContext'

/** One Snackbar for the whole shop; pages call useToast().show('…'). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const show = useCallback((m: string) => setMessage(m), [])
  const api = useMemo(() => ({ show }), [show])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={!!message}
        autoHideDuration={3500}
        onClose={() => setMessage(null)}
        message={message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: 'calc(var(--nav-clearance) + 72px) !important' }}
      />
    </ToastContext.Provider>
  )
}
