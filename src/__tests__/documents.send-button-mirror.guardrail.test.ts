import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-149` — «Отправить заказчику» есть в карточке документа во ВСЕХ трёх
 * кабинетах сотрудников: менеджер, руководитель, администратор.
 *
 * Сервис пускает всех троих. Кнопка, смонтированная у одного, — это внешний
 * вид, а не право: у остальных доступ есть, а способа им воспользоваться
 * нет. Ровно так до этапа 6 жила панель выпуска (`Д-13`), и правило зеркала
 * (§0.2) с тех пор держится механически, а не памятью.
 *
 * Страж смотрит на монтирование, а не на текст кнопки: сама кнопка живёт в
 * общей карточке и проверяется её тестами.
 */
const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('У-149: кнопка отправки — во всех трёх кабинетах сотрудников', () => {
  it('менеджер и руководитель получают её через общую карточку сотрудника', () => {
    const staff = read('components/documents/staff-document-detail.tsx');
    expect(staff, 'общая карточка сотрудника не включает отправку').toMatch(/\bcanSend\b/);

    for (const rel of [
      'app/manager/documents/[id]/page.tsx',
      'app/leader/documents/[id]/page.tsx',
    ]) {
      const src = read(rel);
      expect(src, `${rel} не монтирует общую карточку сотрудника`).toMatch(
        /<StaffDocumentDetail\b/
      );
    }
  });

  it('администратор рисует карточку сам — и тоже с отправкой', () => {
    // Админ монтирует `DocumentDetailView` напрямую, поэтому проп ему нужно
    // передать явно: без стража это самое лёгкое место, где зеркало ломается.
    const src = read('app/admin/documents/[id]/page.tsx');
    expect(src, 'у администратора нет кнопки отправки').toMatch(/\bcanSend\b/);
  });

  it('заказчику кнопка отправки не выдаётся', () => {
    // У заказчика документ и так в кабинете; кнопка «отправить самому себе»
    // бессмысленна, а сервис на неё ответил бы отказом.
    const src = read('app/organization/documents/[id]/page.tsx');
    expect(src, 'кабинет заказчика получил чужую кнопку').not.toMatch(/\bcanSend\b/);
  });
});

describe('У-169: блок «Выгрузка в 1С» — во всех трёх кабинетах сотрудников и только у них', () => {
  it('менеджер и руководитель получают его через общую карточку сотрудника', () => {
    const staff = read('components/documents/staff-document-detail.tsx');
    expect(staff, 'общая карточка сотрудника не монтирует блок выгрузки').toMatch(
      /<DocumentOneCPushBlock\b/
    );
  });

  it('администратор рисует карточку сам — и тоже с блоком выгрузки (зеркало)', () => {
    const src = read('app/admin/documents/[id]/page.tsx');
    expect(src, 'у администратора нет блока выгрузки в 1С').toMatch(/<DocumentOneCPushBlock\b/);
  });

  it('заказчику и партнёру блок не выдаётся: 1С исполнителя им не принадлежит', () => {
    for (const rel of [
      'app/organization/documents/[id]/page.tsx',
      'app/partner/documents/[id]/page.tsx',
      'components/documents/document-detail-view.tsx',
    ]) {
      expect(read(rel), `${rel} получил чужой блок выгрузки`).not.toMatch(
        /DocumentOneCPushBlock/
      );
    }
  });
});
