import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Страж пустых состояний (`У-74`, этап 9).
 *
 * Компонент `EmptyState` существовал и до этапа, но рядом с ним свободно
 * росли самодельные «Нет данных» — вплоть до точной ручной копии его
 * разметки. Такой текст не имеет ни заголовка, ни кнопки, то есть не отвечает
 * на вопрос «что делать дальше».
 *
 * Страж фиксирует текущий список мест, где пустота написана вручную, и не даёт
 * ему расти. Список — не «разрешено навсегда»: это мелкие пустоты **внутри**
 * карточек (комментарии, вложения, оплаты по заказу), где родительский экран
 * уже отвечает на три вопроса, а дюжина серых плиток была бы хуже строки
 * текста. Появился новый файл — либо используйте `EmptyState`, либо осознанно
 * добавьте его сюда с объяснением.
 */
const ALLOWED = new Set([
  // Мелкие пустоты внутри карточек и диалогов — родитель уже всё объяснил.
  join('chat', 'chat-thread-view.tsx'),
  join('staff-chat', 'staff-thread-view.tsx'),
  join('partner', 'deal-comments.tsx'),
  join('manager', 'deal-activity', 'deal-activity-thread.tsx'),
  join('manager', 'manager-payments-list.tsx'),
  join('organization', 'org-payments-list.tsx'),
  join('manager', 'manager-roster-panel.tsx'),
  join('documents', 'documents-panel.tsx'),
  join('client-requests', 'client-request-attachments-list.tsx'),
  join('deals', 'deal-dialog.tsx'),
  join('import', 'import-history.tsx'),
  join('import', 'payment-queue-table.tsx'),
  // Пустота с действием рядом на том же экране (кнопка/форма выше).
  join('partner', 'org-employees-tab.tsx'),
  join('partner', 'customer-access-section.tsx'),
  join('partner', 'partner-enrollments-card.tsx'),
  join('organization', 'org-enrollments-card.tsx'),
  join('partner', 'commission-statements-list.tsx'),
  join('admin', 'managers-block.tsx'),
  join('enrollment', 'enrollment-wizard.tsx'),
  join('manager', 'org-card-tabs.tsx'),
]);

/** Русские обороты, которыми обычно пишут пустое состояние руками. */
const PATTERNS = [/пока нет/i, /пока пусто/i, /Нет данных/i, /ещё не было/i, /Сообщений пока/i];

/**
 * Комментарии из проверки убираем: «кнопки здесь пока нет намеренно» — это
 * пояснение разработчику, а не текст на экране.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = join(base, entry.name);
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

describe('пустые состояния пишутся компонентом, а не руками (У-74)', () => {
  it('новых самодельных пустых состояний в components/ не появилось', () => {
    const root = join(process.cwd(), 'src/components');
    const offenders: string[] = [];
    for (const rel of walk(root)) {
      if (ALLOWED.has(rel)) continue;
      // Сам примитив и его соседи по ui/ — не нарушители.
      if (rel.startsWith(`ui${join('', '')}`) || rel.startsWith('ui/')) continue;
      const src = stripComments(readFileSync(join(root, rel), 'utf8'));
      if (src.includes('EmptyState')) continue; // компонент используется — ок
      if (PATTERNS.some((p) => p.test(src))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('ручной копии разметки EmptyState не осталось', () => {
    // Точный признак копии: белая карточка + серый круг под эмодзи + серый
    // текст — ровно то, что рисует примитив.
    const root = join(process.cwd(), 'src/components');
    const copies: string[] = [];
    for (const rel of walk(root)) {
      if (rel.startsWith('ui/')) continue;
      const src = readFileSync(join(root, rel), 'utf8');
      const hasCard = src.includes('bg-white border border-gray-200 rounded-xl p-12 text-center');
      const hasCircle = src.includes('w-12 h-12 bg-gray-100 rounded-full');
      if (hasCard && hasCircle) copies.push(rel);
    }
    expect(copies).toEqual([]);
  });
});
