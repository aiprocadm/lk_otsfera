import type { PrismaClient } from '@prisma/client';
import { getObjectStorage } from '@/lib/storage';
import { log } from '@/lib/logging';

/**
 * Оформление печатной формы (`У-153`, этап 6): логотип, подпись и печать
 * компании-исполнителя из слотов `У-138`.
 *
 * Три правила, каждое из-за конкретной беды:
 *
 * 1. **Только `clean`.** Непроверенный или заражённый файл в документ не
 *    попадает — иначе антивирус слотов оформления был бы декорацией.
 * 2. **Ничего не блокирует выпуск.** Сбой хранилища, битый файл, чужой формат
 *    — слот просто пустеет, и документ печатается «как сейчас» (`У-153`).
 *    Счёт, который нельзя выставить из-за картинки, — это хуже счёта без
 *    картинки.
 * 3. **Формат проверяем сами.** `@react-pdf` на неизвестных байтах падает уже
 *    внутри рендера, когда номер документа из счётчика уже израсходован.
 */

export type DocumentBranding = {
  logo: Buffer | null;
  signature: Buffer | null;
  stamp: Buffer | null;
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** PNG по сигнатуре, SVG по первым непробельным символам — как их видит `@react-pdf`. */
function isPrintableImage(buffer: Buffer): boolean {
  if (buffer.subarray(0, 4).equals(PNG_MAGIC)) return true;
  const head = buffer.subarray(0, 200).toString('utf-8').trimStart();
  return head.startsWith('<?xml') || head.startsWith('<svg');
}

export async function loadDocumentBranding(
  prisma: PrismaClient,
  companyId: string
): Promise<DocumentBranding> {
  const assets = await prisma.companyBrandingAsset.findMany({
    where: { companyId, scanStatus: 'clean' },
    select: { slot: true, path: true },
  });

  const branding: DocumentBranding = { logo: null, signature: null, stamp: null };
  for (const asset of assets) {
    try {
      const buffer = await getObjectStorage().download(asset.path);
      if (!isPrintableImage(buffer)) {
        log.warn('[documents/branding] unsupported image skipped', {
          companyId,
          slot: asset.slot,
        });
        continue;
      }
      branding[asset.slot] = buffer;
    } catch (err) {
      log.warn('[documents/branding] download failed', {
        companyId,
        slot: asset.slot,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return branding;
}
