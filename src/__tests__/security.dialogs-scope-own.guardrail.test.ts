import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeDialog, dialogWhereForLevel } from '@/lib/auth/accessProfile';
import { dialogScopeWhere, isDialogInScope } from '@/lib/services/messengers/scope';
import { dialogMatchesWhere, type DialogRow } from './helpers/dialogWhere';

/**
 * Сторож охвата «только свои диалоги» (`У-214`, ТЗ 12.09.2026 этап 3).
 *
 * Требование ТЗ дословно: сотрудник с охватом `own` не видит чужой диалог.
 * Держать это сторожем нужно потому, что поломка ТИХАЯ: экран продолжает
 * работать, список просто становится длиннее, чем положено. Ни типы, ни ревью
 * лишнюю строку в выборке не показывают — её видно только по данным.
 *
 * Сторож ПОВЕДЕНЧЕСКИЙ: он не ищет текст в исходнике (такой шаблон легко
 * написать так, что он не совпадёт ни с чем), а прогоняет обе формы правила —
 * условие выборки и проверку строки — по одному набору диалогов.
 *
 * ПРОВЕРЕНО МУТАЦИЕЙ (15.09.2026), обе половины правила по очереди:
 *  1. в `dialogWhereForLevel` из ветки `own` убран `{ assigneeId: session.sub }`
 *     (осталось `mine = { AND: [company] }`) → 3 failed: «условие выборки не
 *     пускает чужой диалог», сверка форм и скоуп списка в сервисах;
 *  2. в `canSeeDialog` ветка `own` заменена на `return true` → 2 failed:
 *     «проверка строки не пускает чужой диалог» и та же сверка форм.
 * После каждой мутации файл возвращён точечной правкой (не `git checkout` —
 * он стёр бы саму работу этапа); `git diff` по боевому коду пуст.
 */

const OWN_PROFILE = {
  id: 'p-own',
  name: 'Только свои диалоги',
  orders: 'own',
  organizations: 'own',
  threads: 'own',
  documents: 'own',
  finance: 'own',
  leads: 'own',
  tasks: 'own',
  dialogs: 'own',
  capabilities: [],
} as const;

/** Сотрудник, которому по профилю положены только свои диалоги. */
const staff = {
  sub: 'u-me',
  role: 'manager',
  companyId: 'co-1',
  managedOrgIds: ['org-mine'],
  accessProfile: OWN_PROFILE,
} as unknown as SessionPayload;

/** Диалог коллеги: та же компания, ответственный — другой человек. */
const FOREIGN: DialogRow = {
  companyId: 'co-1',
  assigneeId: 'u-colleague',
  organizationId: 'org-mine',
};

/** Собственный диалог сотрудника — он обязан остаться видимым. */
const OWN: DialogRow = { companyId: 'co-1', assigneeId: 'u-me', organizationId: null };

/** Ничейный: общая очередь разбора, видна всем (`Р-М-3`). */
const UNBOUND: DialogRow = { companyId: null, assigneeId: null, organizationId: null };

describe('охват «own»: чужой диалог закрыт (У-214)', () => {
  it('условие выборки не пускает чужой диалог', () => {
    const where = dialogWhereForLevel(staff, 'own');
    expect(dialogMatchesWhere(where, FOREIGN), 'диалог коллеги попал в выборку').toBe(false);
  });

  it('проверка строки не пускает чужой диалог', () => {
    expect(canSeeDialog(staff, FOREIGN), 'диалог коллеги открылся по прямой ссылке').toBe(false);
  });

  it('свой диалог и общая очередь при этом остаются видны', () => {
    // Без этой половины сторож можно было бы «починить» запретом всего подряд:
    // сотрудник перестал бы видеть собственную переписку, а тест — молчать.
    const where = dialogWhereForLevel(staff, 'own');
    expect(dialogMatchesWhere(where, OWN)).toBe(true);
    expect(canSeeDialog(staff, OWN)).toBe(true);
    expect(dialogMatchesWhere(where, UNBOUND)).toBe(true);
    expect(canSeeDialog(staff, UNBOUND)).toBe(true);
  });

  it('обе формы правила отвечают одинаково', () => {
    // Расхождение форм — самая неприятная поломка: список показывает диалог,
    // а карточка отвечает «не найдено» (или наоборот).
    const where = dialogWhereForLevel(staff, 'own');
    for (const row of [OWN, FOREIGN, UNBOUND]) {
      expect(dialogMatchesWhere(where, row), JSON.stringify(row)).toBe(canSeeDialog(staff, row));
    }
  });
});

/**
 * Второй контур того же правила: рабочий вход сервисов переписки — не
 * `accessProfile` напрямую, а `scope.ts`. Если однажды там снова заведут
 * «своё» правило вместо обёртки над общим, охват профиля перестанет
 * действовать на списках диалогов, и `accessProfile` останется зелёным.
 */
describe('сервисы переписки берут тот же охват, а не своё правило', () => {
  it('скоуп списка диалогов сужен охватом профиля', () => {
    const where = dialogScopeWhere(staff);
    expect(dialogMatchesWhere(where, FOREIGN), 'список диалогов вернул чужую переписку').toBe(
      false
    );
    expect(dialogMatchesWhere(where, OWN)).toBe(true);
    expect(dialogMatchesWhere(where, UNBOUND)).toBe(true);
  });

  it('точечная проверка сервисов совпадает с общим правилом', () => {
    for (const row of [OWN, FOREIGN, UNBOUND]) {
      expect(isDialogInScope(staff, row), JSON.stringify(row)).toBe(canSeeDialog(staff, row));
    }
  });

  it('без профиля доступа охват прежний — вся компания (правило наслоения)', () => {
    // Оговорку из CLAUDE.md §2b тоже стережём: включение новой модели не должно
    // молча отнять доступ у тех, кому профиль не назначали.
    const legacy = { sub: 'u-me', role: 'manager', companyId: 'co-1' } as unknown as SessionPayload;
    expect(isDialogInScope(legacy, FOREIGN)).toBe(true);
    expect(dialogMatchesWhere(dialogScopeWhere(legacy), FOREIGN)).toBe(true);
  });
});
