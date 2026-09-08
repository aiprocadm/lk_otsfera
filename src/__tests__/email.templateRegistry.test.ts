import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATE_REGISTRY,
  extractTokens,
  isEmailTemplateKey,
  renderTemplateText,
  validateTemplateText,
  checkTemplateLength,
  EMAIL_SUBJECT_MAX,
  EMAIL_BODY_MAX,
} from '@/lib/email/templateRegistry';

/**
 * `У-128`: подстановки в письмах. Главный инвариант — **неизвестная
 * подстановка не сохраняется**, а не превращается в дыру в письме.
 */

describe('реестр шаблонов', () => {
  it('у каждого письма есть название и хотя бы одна подстановка', () => {
    for (const [key, spec] of Object.entries(EMAIL_TEMPLATE_REGISTRY)) {
      expect(spec.label.length, `${key}: нет названия для человека`).toBeGreaterThan(3);
      expect(spec.placeholders.length, `${key}: нечего подставлять`).toBeGreaterThan(0);
    }
  });

  it('подстановки не повторяются внутри письма', () => {
    for (const [key, spec] of Object.entries(EMAIL_TEMPLATE_REGISTRY)) {
      const tokens = spec.placeholders.map((p) => p.token);
      expect(new Set(tokens).size, `${key}: повторяющаяся подстановка`).toBe(tokens.length);
    }
  });

  it('у каждой подстановки есть русское пояснение', () => {
    // Иначе человек угадывает, что такое `{{order.title}}`.
    for (const spec of Object.values(EMAIL_TEMPLATE_REGISTRY)) {
      for (const p of spec.placeholders) {
        expect(p.label.length, `${p.token}: нет пояснения`).toBeGreaterThan(2);
        expect(/[а-яА-Я]/.test(p.label), `${p.token}: пояснение не по-русски`).toBe(true);
      }
    }
  });

  it('чужой ключ письмом не считается', () => {
    expect(isEmailTemplateKey('orgDocumentPublished')).toBe(true);
    expect(isEmailTemplateKey('нет-такого')).toBe(false);
    expect(isEmailTemplateKey('__proto__')).toBe(false);
  });
});

describe('extractTokens', () => {
  it('находит подстановки и терпит пробелы внутри скобок', () => {
    expect(extractTokens('Заказ {{order.number}} и {{ order.title }}')).toEqual([
      'order.number',
      'order.title',
    ]);
  });

  it('текст без подстановок даёт пустой список', () => {
    expect(extractTokens('Просто письмо')).toEqual([]);
  });
});

describe('validateTemplateText — неизвестная подстановка не проходит', () => {
  it('известные подстановки принимаются', () => {
    expect(
      validateTemplateText('orgDocumentPublished', 'Документ {{order.number}}', '{{document.name}}')
    ).toEqual({ ok: true });
  });

  it('выдуманная подстановка отклоняется с перечислением', () => {
    const res = validateTemplateText('orgDocumentPublished', 'Тема', 'Текст {{invoice.total}}');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.unknown).toEqual(['invoice.total']);
  });

  it('проверяется И тема, И текст — опечатка в теме тоже ловится', () => {
    const res = validateTemplateText('orgDocumentPublished', 'Тема {{нет.такого}}', 'Текст');
    expect(res.ok).toBe(false);
  });

  it('подстановка из ЧУЖОГО письма не проходит', () => {
    // `{{partner.name}}` есть у партнёрских писем, но не у этого.
    const res = validateTemplateText('orgDocumentPublished', 'Тема', '{{partner.name}}');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.unknown).toEqual(['partner.name']);
  });
});

describe('renderTemplateText — подстановка значений', () => {
  const props = { orderNumber: 'З-1', documentName: 'Акт.pdf', organizationName: '' };

  it('подставляет значения', () => {
    expect(
      renderTemplateText('orgDocumentPublished', 'Заказ {{order.number}}: {{document.name}}', props)
    ).toBe('Заказ З-1: Акт.pdf');
  });

  it('пустое значение превращается в прочерк, а не в пустоту', () => {
    // «Заказ —» читается как «номера нет», «Заказ » выглядит как обрыв письма.
    expect(renderTemplateText('orgDocumentPublished', '{{organization.name}}', props)).toBe('—');
    expect(renderTemplateText('orgDocumentPublished', '{{order.title}}', props)).toBe('—');
  });

  it('пробелы внутри скобок не мешают', () => {
    expect(renderTemplateText('orgDocumentPublished', '{{ order.number }}', props)).toBe('З-1');
  });

  it('неизвестная подстановка остаётся как есть — сохранение до неё не доводит', () => {
    expect(renderTemplateText('orgDocumentPublished', '{{нет.такого}}', props)).toBe(
      '{{нет.такого}}'
    );
  });
});

describe('checkTemplateLength (`У-128`, хотфикс №22)', () => {
  it('обычные тема и текст проходят', () => {
    expect(checkTemplateLength('Заказ готов', 'Здравствуйте! Ваш заказ готов.')).toEqual({
      ok: true,
    });
  });

  it('тема ровно на пределе — ещё можно, на символ длиннее — уже нет', () => {
    expect(checkTemplateLength('т'.repeat(EMAIL_SUBJECT_MAX), 'текст').ok).toBe(true);
    expect(checkTemplateLength('т'.repeat(EMAIL_SUBJECT_MAX + 1), 'текст')).toEqual({
      ok: false,
      field: 'subject',
      max: EMAIL_SUBJECT_MAX,
    });
  });

  it('текст письма ограничен и называет своё поле', () => {
    expect(checkTemplateLength('Тема', 'б'.repeat(EMAIL_BODY_MAX)).ok).toBe(true);
    expect(checkTemplateLength('Тема', 'б'.repeat(EMAIL_BODY_MAX + 1))).toEqual({
      ok: false,
      field: 'body',
      max: EMAIL_BODY_MAX,
    });
  });

  it('о теме сообщаем раньше, чем о теле: человек правит первое поле сверху', () => {
    const res = checkTemplateLength(
      'т'.repeat(EMAIL_SUBJECT_MAX + 1),
      'б'.repeat(EMAIL_BODY_MAX + 1)
    );
    expect(res).toMatchObject({ ok: false, field: 'subject' });
  });
});
