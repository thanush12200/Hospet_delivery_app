import { supabase } from '@/lib/supabase'

const BUCKET = 'product-images'
const MAX_EDGE_PX = 480
const ENCODE_TIMEOUT_MS = 6000

/**
 * Uploads a product image and returns its public URL.
 *
 * Images are downscaled in the browser before upload. A phone camera produces
 * 3-4MB files; the shop renders them at ~160px. Shipping the original would
 * make the grid unusable on the 4G connections this app has to work on.
 */
export async function uploadProductImage(file: File, productId: string): Promise<string> {
  const { blob, type, ext } = await downscale(file, MAX_EDGE_PX)
  const path = `${productId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: type, upsert: true, cacheControl: '31536000' })
  if (error) throw error

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

interface Encoded { blob: Blob; type: string; ext: string }

/**
 * Draws the image to a canvas at `max` px and re-encodes it.
 *
 * WebP first (roughly 30% smaller), JPEG as fallback. Not every engine can
 * encode WebP: Safari lacked it for years, and some headless builds never
 * invoke the toBlob callback at all rather than returning null. Without the
 * timeout below, an admin on the wrong browser would sit on a spinner forever
 * with no error.
 */
async function downscale(file: File, max: number): Promise<Encoded> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable on this browser')
  // Flatten onto white: JPEG has no alpha, and a transparent PNG would
  // otherwise come out with a black background.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const webp = await encode(canvas, 'image/webp', 0.82)
  if (webp) return { blob: webp, type: 'image/webp', ext: 'webp' }

  const jpeg = await encode(canvas, 'image/jpeg', 0.85)
  if (jpeg) return { blob: jpeg, type: 'image/jpeg', ext: 'jpg' }

  throw new Error('This browser could not encode the image. Try Chrome.')
}

/** Resolves null rather than hanging or throwing when the format is unsupported. */
function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (b: Blob | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Some engines ignore an unsupported type and silently hand back a PNG.
      resolve(b && b.size > 0 && b.type === type ? b : null)
    }
    const timer = setTimeout(() => finish(null), ENCODE_TIMEOUT_MS)
    try {
      canvas.toBlob(finish, type, quality)
    } catch {
      finish(null)
    }
  })
}
