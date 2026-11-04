/** Connection points for outside services.
 *
 *  The brief asks for a GST-portal check on supplier/buyer GST numbers and for
 *  WhatsApp messaging. Both need credentials from the business (a GST API
 *  provider account, a WhatsApp Business account) that are not set up yet, so
 *  the screens are built around these two functions and everything else works
 *  without them. To switch an integration on later, replace the body of the
 *  function below -- no screen has to change.
 *
 *  Do not put API keys in this front-end bundle. Call a Supabase Edge Function
 *  from here and keep the key in that function's secrets. */

export const GST_PORTAL_URL = 'https://services.gst.gov.in/services/searchtp'

export type GstLookupResult =
  | { available: false }
  | { available: true; legalName: string; status: string; state: string }

/** CONNECTION POINT -- live GST portal lookup. Not connected: staff check the
 *  number on the public portal and record the result by hand. */
export async function lookupGst(_gstin: string): Promise<GstLookupResult> {
  return { available: false }
}

/** CONNECTION POINT -- WhatsApp messaging. Not connected. */
export const WHATSAPP_CONNECTED = false

/** CONNECTION POINT -- sending sales confirmations. No WhatsApp or email
 *  provider is connected, so a "send" opens a prefilled WhatsApp chat and a
 *  prefilled email in the person's own apps and they press Send. To automate it,
 *  call a Supabase Edge Function from the Sales confirmations screen instead of
 *  opening these links; the notification log it writes stays the same. */
export function whatsappLink(mobile: string | null | undefined, text: string): string | null {
  const digits = (mobile ?? '').replace(/\D/g, '')
  const full = digits.length === 10 ? `91${digits}` : digits.length >= 11 && digits.length <= 15 ? digits : ''
  return full ? `https://wa.me/${full}?text=${encodeURIComponent(text)}` : null
}

export function emailLink(address: string | null | undefined, subject: string, body: string): string | null {
  const to = (address ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return null
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}