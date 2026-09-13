import { maxFileSizeBytes } from '@/lib/config/upload';
import type { BitrixFile } from '../source';
import type { MappingContext, Plan } from './types';

/**
 * Вложение сделки или компании → `Document` (`У-191`, спека §3.3).
 *
 * Документ в ЛК всегда принадлежит контрагенту, поэтому файл без организации
 * перенести некуда — он честно считается пропущенным. Файл больше предела
 * (200 МБ) тоже пропускается со строкой в отчёте: потоковой загрузки у нас
 * нет, и держать такой файл в памяти нельзя (`В-2-5`).
 *
 * Сама запись файла (антивирус, MIME, хранилище) — дело писателя в PR-4; здесь
 * только решение «переносим / не переносим» и куда.
 */
export type FileData = {
  companyId: string;
  organizationId: string;
  name: string;
  size: number | null;
  downloadUrl: string | null;
  bitrixId: string;
};

export type FileLookup = {
  byBitrixId: (bitrixId: string) => { id: string } | undefined;
  organizationByBitrixId: (bitrixId: string) => string | undefined;
  dealOrganization: (bitrixId: string) => string | undefined;
};

export function planFile(
  file: BitrixFile,
  ctx: MappingContext,
  lookup: FileLookup
): Plan<FileData> {
  if (lookup.byBitrixId(file.id)) return { action: 'skip', reason: 'already_linked' };

  const organizationId =
    file.entity === 'company'
      ? lookup.organizationByBitrixId(file.entityId)
      : lookup.dealOrganization(file.entityId);
  if (!organizationId) return { action: 'skip', reason: 'no_organization' };

  if (file.size !== null && file.size > maxFileSizeBytes()) {
    return { action: 'skip', reason: 'too_large' };
  }

  return {
    action: 'create',
    data: {
      companyId: ctx.companyId,
      organizationId,
      name: file.name,
      size: file.size,
      downloadUrl: file.downloadUrl,
      bitrixId: file.id,
    },
  };
}
