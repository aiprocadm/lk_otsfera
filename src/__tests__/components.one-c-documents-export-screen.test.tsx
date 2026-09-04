import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OneCDocumentsExportScreen } from '@/components/settings/one-c-documents-export-screen';
import type { ExportCandidate } from '@/lib/services/oneCSync/exportPackage';

/**
 * Экран «Выгрузка документов» (`У-173`): три вопроса §15 — где я (заголовок),
 * что здесь (подзаголовок), что дальше (кнопка «Скачать пакет» или пустое
 * состояние с выходом). Кнопка несёт фильтр вкладки, чтобы в архив попало
 * ровно то, что человек видит в списке.
 */
const candidate = (over: Partial<ExportCandidate> = {}): ExportCandidate => ({
  id: 'd1',
  type: 'invoice',
  number: 'С-7',
  name: 'invoice.pdf',
  createdAt: new Date('2026-09-01T10:00:00Z'),
  version: 1,
  counterpartyName: 'ООО «Ромашка»',
  oneCPushStatus: 'none',
  blocked: null,
  ...over,
});

type Props = React.ComponentProps<typeof OneCDocumentsExportScreen>;

function render(over: Partial<Props> = {}): string {
  const props: Props = {
    cabinet: 'admin',
    sp: {},
    items: [],
    ready: 0,
    truncated: false,
    ...over,
  };
  return renderToString(<OneCDocumentsExportScreen {...props} />).replace(/<!-- -->/g, '');
}

describe('OneCDocumentsExportScreen (У-173)', () => {
  it('заголовок, подзаголовок и форма фильтра ведут в свой кабинет', () => {
    const html = render({ cabinet: 'leader' });
    expect(html).toContain('Выгрузка документов');
    expect(html).toContain('Соберите счета, акты и договоры в один архив для 1С');
    expect(html).toContain('action="/leader/settings/integrations/1c/documents"');
    expect(html).toContain('name="from"');
    expect(html).toContain('name="to"');
    expect(html).toContain('aria-label="Вид документа"');
    expect(html).toContain('aria-label="Выгрузка в 1С"');
    // Только выгружаемые типы — КП в списке нет (Р-14).
    expect(html).toContain('value="extra_agreement"');
    expect(html).not.toContain('value="commercial_proposal"');
  });

  it('пусто без фильтра: объясняет, почему, и кнопки сброса нет', () => {
    const html = render();
    expect(html).toContain('Выгружать пока нечего');
    expect(html).toContain('коммерческие предложения не выгружаются');
    expect(html).not.toContain('Сбросить фильтр');
    expect(html).not.toContain('Скачать пакет');
  });

  it('пусто под фильтром: предлагает сбросить фильтр ссылкой на вкладку без query', () => {
    const html = render({ sp: { type: 'act' } });
    expect(html).toContain('Под этот фильтр документов нет');
    expect(html).toContain('href="/admin/settings/integrations/1c/documents"');
    expect(html).toContain('Сбросить фильтр');
  });

  it('главная кнопка несёт фильтр вкладки в query и число документов', () => {
    const html = render({
      sp: { from: '2026-09-01', to: '2026-09-03', type: 'act', oneCPushStatus: 'failed' },
      items: [candidate()],
      ready: 1,
    });
    expect(html).toContain('Скачать пакет (1)');
    expect(html).toContain(
      'href="/api/integrations/1c/documents/export?from=2026-09-01&amp;to=2026-09-03&amp;type=act&amp;oneCPushStatus=failed"'
    );
    // Поля формы помнят выбранное.
    expect(html).toContain('value="2026-09-01"');
    expect(html).toContain('value="2026-09-03"');
  });

  it('кнопки нет, когда в пакет никто не войдёт, даже если список не пуст', () => {
    const html = render({
      items: [candidate({ blocked: 'no_number', number: null })],
      ready: 0,
    });
    expect(html).not.toContain('Скачать пакет');
    expect(html).toContain('Найдено: 1, войдёт в пакет: 0.');
    expect(html).toContain('У остальных не хватает ИНН контрагента или номера');
  });

  it('таблица: тип по-русски, номер, версия, контрагент, статус и причина', () => {
    const html = render({
      items: [
        candidate({ id: 'a', type: 'act', number: 'А-2', version: 2, oneCPushStatus: 'failed' }),
        candidate({
          id: 'b',
          number: null,
          counterpartyName: null,
          blocked: 'counterparty_without_inn',
          oneCPushStatus: 'exported_file',
        }),
      ],
      ready: 1,
    });
    expect(html).toContain('data-testid="export-candidate-a"');
    expect(html).toContain('Акт А-2');
    expect(html).toContain('v2');
    expect(html).toContain('ООО «Ромашка»');
    expect(html).toContain('Ошибка');
    expect(html).toContain('Выгружен файлом');
    // У второго — прочерки и причина.
    expect(html).toContain('Счёт —');
    expect(html).toContain('ИНН');
    expect(html).toContain('Найдено: 2, войдёт в пакет: 1.');
  });

  it('больше лимита — предупреждение, что показаны не все (§15: молчаливое усечение — дефект)', () => {
    const html = render({ items: [candidate()], ready: 1, truncated: true });
    expect(html).toContain('role="status"');
    expect(html).toContain('показаны первые 500');
    expect(render({ items: [candidate()], ready: 1 })).not.toContain('показаны первые');
  });
});
