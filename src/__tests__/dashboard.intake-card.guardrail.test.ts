import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readSource } from './helpers/source';

/**
 * СТРАЖ этапа 4 ТЗ 13.10.2026 (`У-293`, `У-294`, `Р-4-1`, `Р-4-2`): на главной
 * менеджера **одна** карточка обращений — «Свежие обращения», и считает она всю
 * очередь «Входящие в работу», а не «пришедшее за сутки».
 *
 * Было две карточки про одно и то же: «Поступило» (вся очередь) и «Свежие
 * обращения» (входящие письма за сутки + «входящие без разбора за сутки»). ПМ
 * не понял, чем они отличаются, — и был прав.
 *
 * Сменил страж `Р-Э7-6` («Входящие без разбора» названы честно): счётчика «за
 * сутки» больше нет, охранять его имя незачем. Его урок сохранён последней
 * проверкой — подпись не обещает «пропущенные звонки».
 */
const SRC = join(process.cwd(), 'src');
const SERVICE = readSource(join(SRC, 'lib/services/manager/myDay.ts'));
const CARD = readSource(join(SRC, 'components/manager/my-day-cards.tsx'));

describe('страж: одна карточка обращений на всю очередь (У-293, У-294)', () => {
  it('карточка «Свежие обращения» одна, «Поступило» не вернулось', () => {
    expect(CARD.match(/title="Свежие обращения"/g)).toHaveLength(1);
    expect(CARD, 'вернулась вторая карточка про ту же очередь').not.toContain('"Поступило"');
  });

  it('считает всю очередь тем же счётчиком, что и пункт меню, — не «за сутки»', () => {
    expect(SERVICE).toContain('countIntake(prisma, session)');
    expect(SERVICE, 'вернулось окно «за сутки»').not.toMatch(/dayAgo|createdAt: \{ gte/);
    expect(CARD, 'подпись снова про «за сутки»').not.toContain('за сутки');
  });

  it('подстроки сроков ответа — из правила очереди, а не выдуманные', () => {
    expect(SERVICE).toContain('countIntakeSla(prisma, session, now)');
    expect(CARD).toContain('Остался 1 час на ответ');
    expect(CARD).toContain('Просрочено');
  });

  it('подпись не обещает «пропущенные звонки» (урок `Р-Э7-6`)', () => {
    expect(CARD).not.toContain('Пропущенные звонки');
  });
});
