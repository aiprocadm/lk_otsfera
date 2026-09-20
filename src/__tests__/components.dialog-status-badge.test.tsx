/**
 * Значок состояния диалога (`У-207`).
 *
 * Один вид в списке и в карточке (§0.2 «правило зеркала»). Горит **только
 * ожидание ответа сотрудника**: просрочка — красным, приближение к ней —
 * жёлтым. «Ждём клиента» и «Закрыт» спокойные: там от нас ничего не требуется,
 * и цветной значок там означал бы ложную тревогу.
 *
 * У нового диалога без переписки значка нет вовсе: «Новый» рядом с пустой
 * лентой ничего не сообщает.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DialogStatusBadge } from '@/components/manager/messengers/dialog-status-badge';

const html = (status: string, overdue: string) =>
  renderToString(
    <DialogStatusBadge status={status as never} overdue={overdue as never} />
  ).replace(/<!-- -->/g, '');

describe('Ждём ответа сотрудника', () => {
  it('просрочка — красный и прямая приписка «просрочен»', () => {
    const out = html('waiting_staff', 'overdue');

    expect(out).toContain('просрочен');
    expect(out).toContain('red');
  });

  it('приближение к сроку — жёлтый, но без приписки', () => {
    const out = html('waiting_staff', 'warning');

    // Приписка означала бы, что срок уже нарушен: это неправда, и человек
    // перестал бы верить красному.
    expect(out).not.toContain('просрочен');
    expect(out).toContain('amber');
  });

  it('срок ещё не жмёт — спокойный вид', () => {
    const out = html('waiting_staff', 'none');

    expect(out).not.toContain('просрочен');
    expect(out).not.toContain('red');
  });
});

describe('Остальные состояния', () => {
  it.each([
    ['ждём клиента', 'waiting_client'],
    ['закрыт', 'closed'],
  ])('«%s» — нейтральный значок без тревоги', (_name, status) => {
    const out = html(status, 'overdue');

    // Даже с просрочкой: ждать нечего, значит и гореть нечему.
    expect(out).not.toContain('просрочен');
    expect(out).not.toContain('red');
  });

  it('новый диалог без переписки значка не получает', () => {
    expect(html('new', 'none')).toBe('');
  });
});
