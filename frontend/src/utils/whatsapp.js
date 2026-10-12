/** Open WhatsApp chat with pre-filled message (simple mode — no Meta token). */
export function openCustomerWhatsapp(whatsapp) {
  const link = whatsapp?.link;
  if (!link) return false;
  try {
    window.open(link, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    window.location.href = link;
    return true;
  }
}
