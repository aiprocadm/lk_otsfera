import type { PrismaClient } from '@prisma/client';
import { FakeBitrixSource } from './adapter-fake';
import { RestBitrixSource } from './adapter-rest';
import { loadBitrixConnection } from './settings';
import { BitrixSourceError, type BitrixSource } from './source';

/**
 * Фабрика источника (`Р-Б-1`): `file` — выгрузки пакета (PR-2), иначе
 * фикстура при `FAKE_BITRIX=1` (стенд, тесты), иначе REST из настроек
 * `bitrix.*`. Без вебхука — `not_configured`: пакет не создаётся, форма
 * подключения объясняет, чего не хватает.
 */
function isFakeBitrix(): boolean {
  return process.env.FAKE_BITRIX === '1';
}

export async function getBitrixSource(
  prisma: PrismaClient,
  batch: { source: string }
): Promise<BitrixSource> {
  if (batch.source === 'file') {
    // PR-2: файловый источник собирается из ключей S3 пакета.
    throw new BitrixSourceError(
      'source_not_ready',
      'Файловый источник появится следующим PR этапа'
    );
  }
  if (isFakeBitrix()) return new FakeBitrixSource();
  const connection = await loadBitrixConnection(prisma);
  if (!connection.webhookUrl) {
    throw new BitrixSourceError('not_configured', 'Не задан входящий вебхук Битрикс24');
  }
  return new RestBitrixSource({ webhookUrl: connection.webhookUrl });
}
