import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-154` (дефект `Д-17`) — все три роута скачивания документа передают имя
 * файла в подписанную ссылку.
 *
 * Механизм в `s3.ts` был готов давно, а роутам не хватало третьего аргумента:
 * файл сохранялся под ключом хранилища (`invoice-v1-<uuid>.pdf`), и в папке
 * «Загрузки» у клиента копилась россыпь неразличимых файлов. Страж следит
 * именно за этим: подписали ссылку — назовите файл.
 */
const SRC = join(__dirname, '..');

const DOWNLOAD_ROUTES = [
  'app/api/manager/documents/[id]/download/route.ts',
  'app/api/organization/documents/[id]/download/route.ts',
  'app/api/documents/[id]/download/route.ts',
];

describe('У-154: скачивание отдаёт файл под человеческим именем', () => {
  it.each(DOWNLOAD_ROUTES)('%s передаёт имя файла в createSignedUrl', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    const calls = [...src.matchAll(/createSignedUrl\([\s\S]{0,300}?\)\s*;/g)].map((m) => m[0]);
    expect(calls.length, `в ${rel} нет вызова createSignedUrl — страж смотрит не туда`).toBe(1);
    expect(calls[0], `${rel} подписывает ссылку без имени файла (\`Д-17\`)`).toContain('download:');
  });
});
