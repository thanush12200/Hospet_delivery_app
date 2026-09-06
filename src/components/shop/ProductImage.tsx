import { useState } from 'react'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'

/** A failed remote photo must not leave a broken-image icon in the catalogue. */
export function ProductImage({ src, name, eager = false }: { src: string | null; name: string; eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <span className="product-placeholder" aria-label={`No photo for ${name}`}><Inventory2OutlinedIcon /><small>Photo coming soon</small></span>
  return <img src={src} alt={name} width={240} height={240} loading={eager ? 'eager' : 'lazy'}
    decoding="async" onError={() => setFailed(src)} />
}
