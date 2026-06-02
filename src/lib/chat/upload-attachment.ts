/**
 * Client-side helper — uploads a chat attachment via POST /api/messages/attachment.
 * Returns the stored attachmentPath on success, or null on any failure.
 *
 * Side rules:
 *  - Partner / org inboxes omit `side`; server derives it from the session role.
 *  - Team inbox passes `side` explicitly ('org' | 'partner') because manager/admin
 *    sessions have no derivable side.
 */
export async function uploadAttachment(
  file: File,
  orderId: string,
  side?: 'org' | 'partner'
): Promise<string | null> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('orderId', orderId);
  if (side) fd.append('side', side);
  try {
    const res = await fetch('/api/messages/attachment', { method: 'POST', body: fd });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data && data.ok ? (data.attachmentPath as string) : null;
  } catch {
    return null;
  }
}
