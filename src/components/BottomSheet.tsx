import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

/**
 * A bottom sheet on the native <dialog>.
 *
 * modal (default): showModal() — focus trap, Escape and focus restoration
 * for free, and the sheet sits in the browser's top layer above everything.
 *
 * modal={false}: show() with our own scrim. The sheet then stacks below the
 * floating tab bar and the cart bar, so a product can be open while the
 * tabs and the basket stay visible and tappable, iOS-style.
 */
export function BottomSheet({ open, onClose, title, children, maxHeight = '85dvh', modal = true }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; maxHeight?: string; modal?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!open) { dialog.close(); return }
    if (modal) dialog.showModal(); else dialog.show()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    if (!modal) document.addEventListener('keydown', onKey)
    return () => { dialog.close(); document.body.style.overflow = previous; document.removeEventListener('keydown', onKey) }
  }, [open, modal])

  return <>
    {!modal && open && <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />}
    <dialog ref={ref} className={`bottom-sheet${modal ? '' : ' is-floating'}`} aria-labelledby={title ? titleId : undefined}
      style={{ maxHeight }} onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (modal && e.target === e.currentTarget) {
        const box = e.currentTarget.getBoundingClientRect()
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose()
      } }}>
      <div className="sheet-heading"><h2 id={titleId}>{title}</h2><IconButton aria-label="Close" title="Close" onClick={onClose}><CloseIcon /></IconButton></div>
      <div className="sheet-content">{open && children}</div>
    </dialog>
  </>
}
