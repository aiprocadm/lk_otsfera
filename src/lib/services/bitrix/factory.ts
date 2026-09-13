import type { PrismaClient } from '@prisma/client';
import { getObjectStorage } from '@/lib/storage';
import { FakeBitrixSource } from './adapter-fake';
import { FileBitrixSource, type BitrixUploadedFile } from './adapter-file';
import { RestBitrixSource } from './adapter-rest';
import { BITRIX_FILE_ENTITIES, type BitrixFileEntity } from './column-map';
import { loadBitrixConnection } from './settings';
import { BitrixSourceError, type BitrixSource } from './source';

/**
 * Фабрика источника (`Р-Б-1`): `file` — выгрузки пакета из S3 по ключам
 * `settings.fileKeys`, иначе фикстура при `FAKE_BITRIX=1` (стенд, тесты),
 * иначе REST из настроек `bitrix.*`. Без вебхука — `not_configured`: пакет
 * не создаётся, форма подключения объясняет, чего не хватает.
 */
function isFakeBitrix(): boolean {
  return process.env.FAKE_BITRIX === '1';
}

type FileKey = { key: string; name: string; entity: BitrixFileEntity };

/** `settings.fileKeys` пакета: массив `{ key, name, entity }`; мусор отбрасывается молча — источник скажет, что файлов нет. */
function parseFileKeys(settings: unknown): FileKey[] {
  if (!settings || typeof settings !== 'object') return [];
  const raw = (settings as { fileKeys?: unknown }).fileKeys;
  if (!Array.isArray(raw)) return [];
  const out: FileKey[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { key, name, entity } = item as Record<string, unknown>;
    if (typeof key !== 'string' || !key) continue;
    if (
      typeof entity !== 'string' ||
      !(BITRIX_FILE_ENTITIES as readonly string[]).includes(entity)
    ) {
      continue;
    }
    out.push({
      key,
      name: typeof name === 'string' && name ? name : key,
      entity: entity as BitrixFileEntity,
    });
  }
  return out;
}

async function fileSource(settings: unknown): Promise<BitrixSource> {
  const keys = parseFileKeys(settings);
  if (keys.length === 0) {
    throw new BitrixSourceError('source_no_files', 'В пакете нет файлов выгрузки');
  }
  const storage = getObjectStorage();
  const files: BitrixUploadedFile[] = [];
  for (const { key, name, entity } of keys) {
    try {
      files.push({ entity, fileName: name, buffer: await storage.download(key) });
    } catch (e) {
      throw new BitrixSourceError(
        'source_not_ready',
        `Файл выгрузки «${name}» не прочитан из хранилища: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return new FileBitrixSource(files);
}

export async function getBitrixSource(
  prisma: PrismaClient,
  batch: { source: string; settings?: unknown }
): Promise<BitrixSource> {
  if (batch.source === 'file') return fileSource(batch.settings);
  if (isFakeBitrix()) return new FakeBitrixSource();
  const connection = await loadBitrixConnection(prisma);
  if (!connection.webhookUrl) {
    throw new BitrixSourceError('not_configured', 'Не задан входящий вебхук Битрикс24');
  }
  return new RestBitrixSource({ webhookUrl: connection.webhookUrl });
}
