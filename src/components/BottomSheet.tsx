import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

/** Native modal semantics provide focus trapping, Escape and focus restoration. */
export function BottomSheet({ open, onClose, title, children, maxHeight = '85dvh' }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; maxHeight?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!open) { dialog.close(); return }
    dialog.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = previous }
  }, [open])

  return <dialog ref={ref} className="bottom-sheet" aria-labelledby={title ? titleId : undefined}
    style={{ maxHeight }} onCancel={(e) => { e.preventDefault(); onClose() }}
    onClick={(e) => { if (e.target === e.currentTarget) {
      const box = e.currentTarget.getBoundingClientRect()
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose()
    } }}>
    <div className="sheet-heading"><h2 id={titleId}>{title}</h2><IconButton aria-label="Close" title="Close" onClick={onClose}><CloseIcon /></IconButton></div>
    <div className="sheet-content">{open && children}</div>
  </dialog>
}
