import { describe, it, expect } from 'vitest';
import { IMPORT_MAX_FILE_MB, IMPORT_MAX_FILE_BYTES } from '@/lib/config/import-limits';
// next.config.mjs читается до сборки и TS импортировать не может, поэтому число
// там продублировано — сверяем, чтобы предел не разъехался снова (Т-5).
import { SERVER_ACTIONS_BODY_LIMIT_MB } from '../../next.config.mjs';

describe('предел размера файла импорта', () => {
  it('общий предел тела запроса в next.config совпадает с константой', () => {
    expect(SERVER_ACTIONS_BODY_LIMIT_MB).toBe(IMPORT_MAX_FILE_MB);
  });

  it('байты считаются от мегабайт', () => {
    expect(IMPORT_MAX_FILE_BYTES).toBe(IMPORT_MAX_FILE_MB * 1024 * 1024);
  });

  it('предел — 25 МБ по решению заказчика (годовая «Карточка счёта 51»)', () => {
    expect(IMPORT_MAX_FILE_MB).toBe(25);
  });
});
