import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Свои тексты писем поверх встроенных (`У-128`).
 *
 * Приоритет тот же, что у правил: **компания → платформа → код**. Два правила
 * важнее прочих. **Сбой чтения не роняет отправку** — письмо уйдёт встроенным
 * шаблоном: направление отказа «отправить», а не «промолчать». И **пустой
 * текст считается отсутствующим** — иначе сохранённая пустая запись
 * превратила бы письмо в пустое.
 */
const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));

import { getTemplateOverride, applyOverride, listTemplates } from '@/lib/email/templateOverrides';
import { EMAIL_TEMPLATE_REGISTRY } from '@/lib/email/templateRegistry';

type Row = { companyId: string | null; templateKey?: string; subject: string; body: string };

/** Подставная база: либо отдаёт строки, либо бросает то, что дали. */
function db(rows: Row[] | { throws: unknown }) {
  return {
    notificationTemplate: {
      findMany: vi.fn(async () => {
        if (!Array.isArray(rows)) throw rows.throws;
        return rows;
      }),
    },
  } as never;
}

const KEY = 'notification' as const;

beforeEach(() => vi.clearAllMocks());

describe('getTemplateOverride — действующий текст письма', () => {
  it('записей нет — «как раньше», встроенным шаблоном', async () => {
    await expect(getTemplateOverride(db([]), KEY, 'c1')).resolves.toBeNull();
  });

  it('текст компании перекрывает платформенный', async () => {
    const res = await getTemplateOverride(
      db([
        { companyId: null, subject: 'Платформа', body: 'текст платформы' },
        { companyId: 'c1', subject: 'Компания', body: 'текст компании' },
      ]),
      KEY,
      'c1'
    );

    expect(res).toEqual({ subject: 'Компания', body: 'текст компании' });
  });

  it('своего текста нет — берётся платформенный', async () => {
    const res = await getTemplateOverride(
      db([{ companyId: null, subject: 'Платформа', body: 'текст' }]),
      KEY,
      'c1'
    );

    expect(res).toEqual({ subject: 'Платформа', body: 'текст' });
  });

  it('без компании ищем только платформенный уровень', async () => {
    const database = db([{ companyId: null, subject: 'П', body: 'т' }]);

    await getTemplateOverride(database, KEY);

    const where = (
      database as unknown as {
        notificationTemplate: {
          findMany: { mock: { calls: Array<[{ where: { OR: unknown[] } }]> } };
        };
      }
    ).notificationTemplate.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ companyId: null }]);
  });

  it('пустые тема и текст считаются отсутствием — письмо не станет пустым', async () => {
    const res = await getTemplateOverride(
      db([{ companyId: 'c1', subject: '  ', body: '' }]),
      KEY,
      'c1'
    );

    expect(res).toBeNull();
  });

  it('сбой чтения не роняет отправку — пишем предупреждение и шлём встроенным', async () => {
    const res = await getTemplateOverride(db({ throws: new Error('база недоступна') }), KEY, 'c1');

    expect(res).toBeNull();
    expect(logWarn).toHaveBeenCalledWith(
      '[email] свой текст письма недоступен — отправляем встроенным',
      expect.objectContaining({ template: KEY, error: 'база недоступна' })
    );
  });

  it('в журнал попадает и не-ошибка — строкой, а не «[object Object]»', async () => {
    await getTemplateOverride(db({ throws: 'что-то пошло не так' }), KEY, 'c1');

    expect(logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'что-то пошло не так' })
    );
  });
});

describe('applyOverride — подстановки заменены', () => {
  it('тема и текст проходят через подстановку', () => {
    const res = applyOverride(
      KEY,
      { subject: 'Привет, {{recipient.name}}', body: '{{title}}' },
      { recipientName: 'Пётр', title: 'Заголовок' }
    );

    expect(res.subject).toContain('Пётр');
    expect(res.text).toContain('Заголовок');
  });
});

describe('listTemplates — список для экрана', () => {
  const total = Object.keys(EMAIL_TEMPLATE_REGISTRY).length;

  it('без записей все письма показываются встроенными', async () => {
    const rows = await listTemplates(db([]), 'c1');

    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.source === 'default')).toBe(true);
    expect(rows.every((r) => r.subject === '' && r.body === '')).toBe(true);
  });

  it('свой текст помечается «company», платформенный — «platform»', async () => {
    const keys = Object.keys(EMAIL_TEMPLATE_REGISTRY);
    const first = keys[0]!;
    const second = keys[1]!;

    const rows = await listTemplates(
      db([
        { companyId: 'c1', templateKey: first, subject: 'своя', body: 'свой' },
        { companyId: null, templateKey: second, subject: 'платформа', body: 'текст' },
      ]),
      'c1'
    );

    expect(rows.find((r) => r.key === first)).toMatchObject({
      source: 'company',
      subject: 'своя',
    });
    expect(rows.find((r) => r.key === second)).toMatchObject({
      source: 'platform',
      subject: 'платформа',
    });
  });

  it('без компании свои тексты не подхватываются даже если они в выборке', async () => {
    const first = Object.keys(EMAIL_TEMPLATE_REGISTRY)[0]!;

    const rows = await listTemplates(
      db([{ companyId: 'c1', templateKey: first, subject: 'своя', body: 'свой' }]),
      null
    );

    expect(rows.find((r) => r.key === first)?.source).toBe('default');
  });

  it('сбой чтения не ломает экран — показываем встроенные и пишем предупреждение', async () => {
    const rows = await listTemplates(db({ throws: new Error('нет связи') }), 'c1');

    expect(rows).toHaveLength(total);
    expect(rows.every((r) => r.source === 'default')).toBe(true);
    expect(logWarn).toHaveBeenCalledWith(
      '[email] свои тексты недоступны — показываем встроенные',
      expect.objectContaining({ error: 'нет связи' })
    );
  });

  it('не-ошибка в журнале тоже строкой', async () => {
    await listTemplates(db({ throws: 'строка' }), 'c1');

    expect(logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'строка' })
    );
  });
});
