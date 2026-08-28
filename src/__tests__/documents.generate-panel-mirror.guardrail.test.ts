import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOptInFlag } from '@/lib/featureFlags';

/**
 * `У-144` (дефект `Д-13`) — выпуск документов доступен из карточки заказа во
 * ВСЕХ ТРЁХ кабинетах сотрудников: менеджер, руководитель, админ.
 *
 * До этапа 6 панель была смонтирована только у менеджера, хотя сервис пускал
 * и руководителя, и админа. Скрытая кнопка — это внешний вид, а не право:
 * получалось, что руководитель имел доступ, но не имел способа им
 * воспользоваться. Правило зеркала (§0.2) требует одного и того же места и
 * названия во всех кабинетах — здесь оно держится механически.
 */
const SRC = join(__dirname, '..');

const ORDER_PAGES = [
  'app/manager/orders/[id]/page.tsx',
  'app/leader/orders/[id]/page.tsx',
  'app/admin/orders/[id]/page.tsx',
];

describe('У-144: панель выпуска — во всех трёх кабинетах', () => {
  it.each(ORDER_PAGES)('%s монтирует общий компонент панели', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    expect(src, `${rel} не импортирует панель выпуска`).toContain(
      "from '@/components/manager/generate-documents-panel'"
    );
    expect(src, `${rel} не рендерит <GenerateDocumentsPanel>`).toMatch(
      /<GenerateDocumentsPanel\b/
    );
    // Мало объявить панель — она должна ДОЙТИ до разметки. Первая версия
    // стража этого не проверяла и молчала, когда со страницы руководителя
    // убрали передачу готового узла в деталку: код панели остался, а на
    // экране её не было.
    const jsx = src.slice(src.lastIndexOf('return ('));
    expect(jsx, `${rel} собирает панель, но не показывает её`).toMatch(/generatePanel|<GenerateDocumentsPanel\b/);
    // Флаг уважают все три: выключенный флаг не должен прятать панель
    // выборочно в одном кабинете.
    expect(src, `${rel} монтирует панель мимо флага`).toContain("isFeatureEnabled('document_generation')");
  });

  it('флаг выпуска документов включён по умолчанию (`У-144`, дефект `Д-20`)', () => {
    // Выпуск документов — основная работа сотрудника, а не эксперимент.
    expect(isOptInFlag('document_generation')).toBe(false);
  });
});
