/** WhatsApp deep link with an optional prefilled message. */
export function waLink(whatsapp: string, text?: string): string {
  const digits = whatsapp.replace(/\D/g, '')
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/\s/g, '')}`
}
