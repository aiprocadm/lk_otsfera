import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_TEMPLATE_REGISTRY } from '@/lib/email/templateRegistry';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';

/**
 * Страж PR-6 этапа 4: свои тексты писем применяются, а не только сохраняются
 * (`У-128`).
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('У-128: свой текст доходит до письма', () => {
  it('email-канал спрашивает переопределение', () => {
    // Экран, который сохраняет текст, но не влияет на письма, — худший исход.
    const src = read('lib/notifications/channels/email.ts');
    expect(src, 'канал не спрашивает свой текст').toContain('getTemplateOverride(');
    expect(src, 'свой текст посчитан, но не применён').toContain('applyOverride(');
  });

  it('вёрстка письма остаётся прежней', () => {
    // Из переопределения берутся только тема и текст: иначе первое же
    // изменённое письмо потеряло бы фирменный вид и выглядело бы как спам.
    const src = read('lib/notifications/channels/email.ts');
    expect(src, 'своё письмо шлётся мимо общей вёрстки').toContain('sendNotificationEmail(');
  });

  it('компания-продавец доходит до письма', () => {
    const payload = read('lib/notifications/channels/types.ts');
    expect(payload, 'в письме нет компании — тексты компании не применятся').toContain(
      'companyId?: string | null | undefined;'
    );
    expect(read('lib/notifications/org.ts')).toContain('companyId: org.companyId');
  });
});

describe('У-128: неизвестная подстановка не сохраняется', () => {
  it('сохранение проверяет обе части письма', () => {
    const src = read('server-actions/admin/emailTemplates.ts');
    expect(src).toContain('validateTemplateText(key, subject, body)');
    expect(src).toContain('unknown_placeholder');
  });

  it('предпросмотр и пробное письмо проверяют то же самое', () => {
    // Иначе «показать» работало бы там, где «сохранить» откажет.
    const src = read('server-actions/admin/emailTemplates.ts');
    const checks = (src.match(/validateTemplateText\(/g) ?? []).length;
    expect(checks, 'проверка подстановок не во всех трёх действиях').toBeGreaterThanOrEqual(3);
  });

  it('пробное письмо уходит только себе', () => {
    // Отправка на произвольный адрес превратила бы настройки в рассыльщик.
    const src = read('server-actions/admin/emailTemplates.ts');
    // Проверяем САМУ строку получения адреса. «В файле есть session.email»
    // проходило и когда адрес подмешивался снаружи — поймано мутацией.
    expect(src, 'адрес получателя берётся не только из сессии').toContain(
      'const to = session.email?.trim();'
    );
    expect(src, 'адрес получателя приходит снаружи').not.toMatch(/to: string[,)]/);
  });

  it('пробное письмо помечено как проверка', () => {
    const src = read('server-actions/admin/emailTemplates.ts');
    expect(src).toContain('[проверка]');
  });
});

describe('У-128: область правки задаёт роль', () => {
  it('компания берётся из сессии, а не из аргументов', () => {
    const src = read('server-actions/admin/emailTemplates.ts');
    expect(src).toContain('session.companyId');
    expect(src).toContain('if (!companyId) return { ok: false }');
  });

  it('«вернуть стандартный» удаляет свой текст, а не копирует встроенный', () => {
    // Копия заморозила бы письмо: код менялся бы, а текст компании — нет.
    const src = read('server-actions/admin/emailTemplates.ts');
    expect(src).toContain('notificationTemplate.deleteMany');
    expect(src).toContain('companyId: scope.companyId, templateKey: key');
  });

  it('стандартного текста нет ни в реестре, ни в модели', () => {
    // Вторая версия правды разъехалась бы при первой правке шаблона.
    const registry = read('lib/email/templateRegistry.ts');
    expect(registry, 'в реестр попала копия стандартного текста').not.toMatch(
      /defaultSubject|defaultBody/
    );
  });
});

describe('У-128: экран заведён и защищён', () => {
  it('раздел есть у администратора и руководителя', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.emailTemplates');
    expect(section, 'раздел пропал из реестра — в меню его не будет').toBeDefined();
    expect(section?.cabinets).toEqual(['admin', 'leader']);
  });

  it('обе страницы зовут гард раздела', () => {
    for (const cabinet of ['admin', 'leader']) {
      const src = read(`app/${cabinet}/settings/catalogs/email-templates/page.tsx`);
      expect(src, `${cabinet}: страница без гарда раздела`).toContain(
        "requireSettingsSection('catalogs.emailTemplates'"
      );
    }
  });

  it('список подстановок показан рядом с полями', () => {
    // Иначе человек угадывает имена и получает отказ сохранить.
    const src = read('components/settings/email-templates-editor.tsx');
    expect(src).toContain('EMAIL_TEMPLATE_REGISTRY');
    expect(src).toContain('Что можно подставить');
  });

  it('у каждого письма из реестра каналов есть настраиваемый текст', () => {
    // Иначе часть писем молча осталась бы неизменяемой.
    const channelKeys = Object.keys(EMAIL_TEMPLATE_REGISTRY);
    const src = read('lib/notifications/channels/email.ts');
    for (const key of channelKeys) {
      expect(src, `${key}: письма нет в реестре отправителей`).toContain(`${key}:`);
    }
  });
});
