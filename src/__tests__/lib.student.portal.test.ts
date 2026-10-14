import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { settings } = vi.hoisted(() => ({ settings: new Map<string, string | null>() }));
vi.mock('@/lib/config/integrationSettings', () => ({
  getSettingValue: async (_p: unknown, key: string) => settings.get(key) ?? null,
}));

import {
  getStudentPortalConfig,
  isPlaceholderPortalHost,
  parseHostList,
  validatePortalSettings,
} from '@/lib/student/portal';

/**
 * Адрес учебной площадки из интерфейса (`У-274`, ТЗ 13.10.2026, `Д-53`): на
 * стенде в переменной сервера стоял пример `lms.example.com`, и «Перейти к
 * обучению» вела на несуществующий сайт.
 */
const prisma = {} as never;

beforeEach(() => {
  settings.clear();
  delete process.env.STUDENT_PORTAL_URL;
  delete process.env.STUDENT_PORTAL_ALLOWED_HOSTS;
});
afterEach(() => {
  delete process.env.STUDENT_PORTAL_URL;
  delete process.env.STUDENT_PORTAL_ALLOWED_HOSTS;
});

describe('isPlaceholderPortalHost', () => {
  it('примеры и тестовые зоны — заглушки, настоящие домены — нет', () => {
    for (const h of [
      'lms.example.com',
      'example.com',
      'a.example.org',
      'x.example.net',
      'site.test',
      'foo.example',
      'bar.invalid',
      'my.localhost',
      'localhost',
      '127.0.0.1',
    ]) {
      expect(isPlaceholderPortalHost(h), h).toBe(true);
    }
    for (const h of ['otsfera.cdoprof.com', 'lms.otsfera.ru', 'examples.com']) {
      expect(isPlaceholderPortalHost(h), h).toBe(false);
    }
  });
});

describe('parseHostList', () => {
  it('через запятую, без пробелов и регистра, без масок', () => {
    expect(parseHostList(' A.ru, b.ru ,,*.evil.ru ')).toEqual(['a.ru', 'b.ru']);
    expect(parseHostList(null)).toEqual([]);
    expect(parseHostList(undefined)).toEqual([]);
  });
});

describe('getStudentPortalConfig', () => {
  it('адрес из настроек + встроенный домен заказчика и домены из поля', async () => {
    settings.set('student.redirectUrl', 'https://lms.otsfera.ru/sso');
    settings.set('student.allowedDomains', 'lms.otsfera.ru');
    expect(await getStudentPortalConfig(prisma)).toEqual({
      status: 'ready',
      redirectUrl: 'https://lms.otsfera.ru/sso',
      allowlist: ['otsfera.cdoprof.com', 'lms.otsfera.ru'],
    });
  });

  it('адреса нет — «не подключено»', async () => {
    expect(await getStudentPortalConfig(prisma)).toEqual({ status: 'not_connected' });
  });

  it('заглушка из примера — «не подключено», а не переход в никуда', async () => {
    settings.set('student.redirectUrl', 'https://lms.example.com/auth/bridge');
    expect(await getStudentPortalConfig(prisma)).toEqual({ status: 'not_connected' });
  });

  it('неразбираемый адрес не считается заглушкой — его отбракует проверка безопасности перехода', async () => {
    settings.set('student.redirectUrl', 'not a url');
    expect(await getStudentPortalConfig(prisma)).toMatchObject({
      status: 'ready',
      redirectUrl: 'not a url',
    });
  });

  it('легаси-переменные — запасной вариант, если настроек нет', async () => {
    process.env.STUDENT_PORTAL_URL = 'https://otsfera.cdoprof.com/old';
    process.env.STUDENT_PORTAL_ALLOWED_HOSTS = 'old.ru';
    expect(await getStudentPortalConfig(prisma)).toEqual({
      status: 'ready',
      redirectUrl: 'https://otsfera.cdoprof.com/old',
      allowlist: ['otsfera.cdoprof.com', 'old.ru'],
    });
  });

  it('домены из настроек важнее легаси-переменной', async () => {
    settings.set('student.redirectUrl', 'https://otsfera.cdoprof.com/');
    settings.set('student.allowedDomains', 'new.ru');
    process.env.STUDENT_PORTAL_ALLOWED_HOSTS = 'old.ru';
    expect(await getStudentPortalConfig(prisma)).toMatchObject({
      allowlist: ['otsfera.cdoprof.com', 'new.ru'],
    });
  });
});

describe('validatePortalSettings', () => {
  it('пустой адрес — допустим («не подключено»)', () => {
    expect(validatePortalSettings({ redirectUrl: '  ', allowedDomains: '' })).toEqual({ ok: true });
  });

  it('не ссылка и не https — student_portal_url_invalid', () => {
    expect(validatePortalSettings({ redirectUrl: 'otsfera', allowedDomains: '' })).toEqual({
      ok: false,
      error: 'student_portal_url_invalid',
    });
    expect(
      validatePortalSettings({ redirectUrl: 'http://otsfera.cdoprof.com/', allowedDomains: '' })
    ).toEqual({ ok: false, error: 'student_portal_url_invalid' });
  });

  it('домен не в разрешённых — student_portal_host_not_allowed; встроенный и добавленный — ок', () => {
    expect(
      validatePortalSettings({ redirectUrl: 'https://lms.otsfera.ru/', allowedDomains: '' })
    ).toEqual({ ok: false, error: 'student_portal_host_not_allowed' });
    expect(
      validatePortalSettings({ redirectUrl: 'https://otsfera.cdoprof.com/', allowedDomains: '' })
    ).toEqual({ ok: true });
    expect(
      validatePortalSettings({
        redirectUrl: 'https://LMS.otsfera.ru/x',
        allowedDomains: 'lms.otsfera.ru',
      })
    ).toEqual({ ok: true });
  });
});
