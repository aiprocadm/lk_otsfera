import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * Шифрование секретов интеграций (токены ботов, ключи API, пароли ящиков)
 * перед записью в БД (модель IntegrationSetting, isSecret=true).
 *
 * Алгоритм: AES-256-GCM. Мастер-ключ — env APP_ENCRYPTION_KEY (единственный
 * секрет, остающийся на сервере; без него шифрование бессмысленно). Ключ
 * принимается как 64-символьный hex (32 байта) ЛИБО любая строка ≥16 символов,
 * из которой ключ выводится SHA-256 (чтобы владелец мог задать парольную фразу).
 *
 * Формат хранимого значения: `v1:<base64(iv[12] ‖ tag[16] ‖ ciphertext)>`.
 * Префикс версии — на случай ротации схемы. Открытый текст в БД для секретов
 * не хранится никогда.
 */

const VERSION = 'v1';

class SecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsKeyError';
  }
}

function resolveKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new SecretsKeyError(
      'APP_ENCRYPTION_KEY не задан — невозможно шифровать/расшифровать секреты интеграций'
    );
  }
  // 64 hex-символа = ровно 32 байта: используем как есть.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  if (raw.length < 16) {
    throw new SecretsKeyError('APP_ENCRYPTION_KEY слишком короткий (минимум 16 символов)');
  }
  // Иначе выводим 32-байтовый ключ из парольной фразы.
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** true, если мастер-ключ доступен (можно шифровать/расшифровывать). */
export function isSecretsKeyConfigured(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const key = resolveKey();
  const [version, payload] = stored.split(':', 2);
  if (version !== VERSION || !payload) {
    throw new SecretsKeyError('Неподдерживаемый формат зашифрованного секрета');
  }
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
