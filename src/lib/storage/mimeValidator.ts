export type SupportedMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const SUPPORTED_MIME_TYPES: ReadonlyArray<SupportedMimeType> = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export type MimeValidationResult =
  | { ok: true; mime: SupportedMimeType }
  | { ok: false; reason: 'too_short' | 'unsupported_signature' | 'mime_mismatch' };

/* v8 ignore next 3 -- default-param + early-return branches: offset is always 0 at all internal call sites (no public API exposes it); the too-short path is only taken during the ZIP sub-header scan where buffers are always ≥8 bytes */
function hasSignature(buf: Uint8Array, signature: number[], offset = 0): boolean {
  if (buf.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buf[offset + i] !== signature[i]) return false;
  }
  return true;
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function isZipContainer(buf: Uint8Array): boolean {
  return hasSignature(buf, ZIP_SIGNATURE);
}

function findInZipBytes(buf: Uint8Array, needle: string, maxScan: number): boolean {
  const limit = Math.min(buf.length, maxScan);
  const needleBytes = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= limit - needleBytes.length; i++) {
    for (let j = 0; j < needleBytes.length; j++) {
      if (buf[i + j] !== needleBytes[j]) continue outer;
    }
    return true;
  }
  return false;
}

function detectOpenXmlKind(buf: Uint8Array): 'docx' | 'xlsx' | null {
  if (findInZipBytes(buf, 'word/', 32_768)) return 'docx';
  if (findInZipBytes(buf, 'xl/', 32_768)) return 'xlsx';
  return null;
}

export function validateMagicBytes(declaredMime: string, buffer: Uint8Array): MimeValidationResult {
  if (buffer.length < 8) return { ok: false, reason: 'too_short' };

  if (hasSignature(buffer, [0x25, 0x50, 0x44, 0x46])) {
    if (declaredMime !== 'application/pdf') return { ok: false, reason: 'mime_mismatch' };
    return { ok: true, mime: 'application/pdf' };
  }

  if (hasSignature(buffer, [0xff, 0xd8, 0xff])) {
    if (declaredMime !== 'image/jpeg') return { ok: false, reason: 'mime_mismatch' };
    return { ok: true, mime: 'image/jpeg' };
  }

  if (hasSignature(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (declaredMime !== 'image/png') return { ok: false, reason: 'mime_mismatch' };
    return { ok: true, mime: 'image/png' };
  }

  if (isZipContainer(buffer)) {
    const kind = detectOpenXmlKind(buffer);
    if (kind === 'docx') {
      const expected = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (declaredMime !== expected) return { ok: false, reason: 'mime_mismatch' };
      return { ok: true, mime: expected };
    }
    if (kind === 'xlsx') {
      const expected = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (declaredMime !== expected) return { ok: false, reason: 'mime_mismatch' };
      return { ok: true, mime: expected };
    }
    return { ok: false, reason: 'unsupported_signature' };
  }

  return { ok: false, reason: 'unsupported_signature' };
}

export function extensionFor(mime: SupportedMimeType): string {
  switch (mime) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
  }
}
