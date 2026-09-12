import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { SETTING_SPECS } from '@/lib/config/integrationSettings';
import { SETTINGS_SECTIONS } from '@/lib/navigation/settings';
import { ALL_SCHEDULES } from '@/lib/jobs/scheduling';
import { LOGIN_POLICY_FIELDS } from '@/lib/auth/loginPolicyFields';
import { readSource } from './helpers/source';

/**
 * Страж PR-7 этапа 4: политики входа (`У-129`) и переезд SLA (`У-130`).
 */
const SRC = join(__dirname, '..');
const read = (p: string) => readSource(join(SRC, p));

describe('У-129: политики входа настраиваются из интерфейса', () => {
  /**
   * Список написан ЗДЕСЬ, а не взят из проверяемого файла. Пока страж
   * перебирал сам `LOGIN_POLICY_FIELDS`, он сверял список с самим собой:
   * подмена одного параметра дублем другого проходила — длина та же, ключи в
   * реестре есть, а «срок действия приглашения» пропадал с экрана «Политики
   * входа», и настраивать его снова пришлось бы через `.env` (мутация `С-5`,
   * прогон сопровождения №25). Эталон здесь — `У-129`.
   */
  const EXPECTED_KEYS = [
    'login.twoFactorCodeTtlMinutes',
    'login.twoFactorMaxAttempts',
    'login.backupCodesCount',
    'login.rateLimitMax',
    'login.rateLimitWindowMs',
    'login.inviteTtlDays',
    'login.resetTtlHours',
  ];

  it('все семь параметров есть в реестре настроек', () => {
    expect(
      LOGIN_POLICY_FIELDS.map((f) => f.key).sort(),
      'набор политик входа разошёлся с У-129'
    ).toEqual([...EXPECTED_KEYS].sort());
    // Дубль имени поля формы показал бы два одинаковых поля вместо разных.
    expect(new Set(LOGIN_POLICY_FIELDS.map((f) => f.field)).size, 'дубль имени поля формы').toBe(
      LOGIN_POLICY_FIELDS.length
    );
    for (const f of LOGIN_POLICY_FIELDS) {
      expect(SETTING_SPECS, `${f.key}: нет в реестре настроек`).toHaveProperty(f.key);
    }
  });

  it('у бывших констант кода переменной окружения нет и не выдумано', () => {
    // Выдуманное имя сбило бы стражи `У-122`/`У-134`, которые сверяют реестр
    // с `.env.example`.
    for (const key of [
      'login.twoFactorCodeTtlMinutes',
      'login.twoFactorMaxAttempts',
      'login.backupCodesCount',
    ]) {
      expect(SETTING_SPECS[key as keyof typeof SETTING_SPECS].envVar, key).toBeNull();
    }
  });

  it('у бывших переменных сервера запасное чтение сохранено', () => {
    // Старый `.env` обязан продолжать работать.
    expect(read('lib/auth/passwordReset.ts')).toContain('process.env.INVITE_TOKEN_TTL_DAYS');
    expect(read('lib/auth/passwordReset.ts')).toContain('process.env.RESET_TOKEN_TTL_HOURS');
    const login = read('app/api/auth/login/route.ts');
    expect(login).toContain('process.env.LOGIN_RATE_LIMIT_WINDOW_MS');
    expect(login).toContain('process.env.LOGIN_RATE_LIMIT_MAX');
  });

  it('второй шаг входа читает настройки на каждый вызов, а не при загрузке модуля', () => {
    // Модульная константа подхватила бы правку только после перезапуска —
    // ровно та беда, которую этап и чинит.
    const src = read('lib/services/auth/twoFactor.ts');
    expect(src).toContain('cachedIntegrationSetting');
    expect(src, 'значения снова вычисляются один раз при загрузке').toMatch(
      /function codeTtlMs\(\): number \{/
    );
    expect(src).not.toMatch(/^const CODE_TTL_MS =/m);
  });

  it('лимиты входа читаются внутри обработчика, а не на уровне модуля', () => {
    const src = read('app/api/auth/login/route.ts');
    expect(src, 'лимиты снова стали модульными константами').not.toMatch(/^const WINDOW_MS =/m);
    expect(src).toMatch(/function loginLimits\(\)/);
    // И снапшот настроек праймится ДО первой проверки: вход идёт до сессии.
    expect(src, 'лимиты читаются без прайма — из базы они не подтянутся').toMatch(
      /await primeIntegrationSettingsCache\(prisma\);[\s\S]{0,200}loginLimits\(\)/
    );
  });

  it('границы значений проверяются', () => {
    // Ноль попыток — никто не войдёт; сутки на ввод кода — код перестаёт быть
    // одноразовым по смыслу.
    const src = read('server-actions/admin/loginPolicies.ts');
    expect(src).toMatch(/parsed < f\.min \|\| parsed > f\.max/);
    for (const f of LOGIN_POLICY_FIELDS) {
      expect(f.min, `${f.key}: нижняя граница не задана`).toBeGreaterThan(0);
      expect(f.max, `${f.key}: верхняя граница не больше нижней`).toBeGreaterThan(f.min);
    }
  });

  it('изменение спрашивает подтверждение', () => {
    // Ошибка в этих числах может закрыть вход всем сразу.
    expect(read('components/settings/login-policies-form.tsx')).toContain('window.confirm');
  });

  it('раздел платформенный — только администратор', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'security.loginPolicies');
    expect(section, 'раздел пропал из реестра').toBeDefined();
    expect(section?.cabinets, 'вход один на систему — компанийского уровня нет').toEqual(['admin']);
  });
});

describe('У-130: SLA переехал из «Команды» в хаб', () => {
  it('карточки SLA на вкладке «Команда» больше нет', () => {
    // Настройка процесса в разделе про людей — это и было расхождение.
    const src = read('app/leader/team/page.tsx');
    expect(src, 'карточка SLA вернулась в «Команду»').not.toContain('SlaSettingsCard');
    expect(src, 'страница команды снова тянет пороги SLA').not.toContain('getSlaSettings');
  });

  it('раздел заведён у администратора и руководителя', () => {
    const section = SETTINGS_SECTIONS.find((s) => s.id === 'catalogs.slaIntake');
    expect(section, 'раздел пропал из реестра').toBeDefined();
    expect(section?.cabinets).toEqual(['admin', 'leader']);
    // Название по глоссарию: эскалирует очередь Intake, а не «Обращения».
    expect(section?.title).toBe('SLA входящих в работу');
  });

  it('обе страницы зовут гард раздела', () => {
    for (const cabinet of ['admin', 'leader']) {
      const src = read(`app/${cabinet}/settings/catalogs/sla-intake/page.tsx`);
      expect(src, `${cabinet}: страница без гарда раздела`).toContain(
        "requireSettingsSection('catalogs.slaIntake'"
      );
    }
  });

  it('руководитель правит СВОЮ компанию, а не выбранную в адресе', () => {
    // Выборка живёт в сервисе, а не в компоненте (`components-no-db`):
    // скоуп держит `listCompaniesSla`, экран лишь показывает данные.
    const src = read('lib/services/manager/slaSettings.ts');
    expect(src).toContain('session.companyId');
    // Админ видит все компании — это его картина целиком.
    expect(src).toContain('orderBy: { name:');
    // А компонент в базу не ходит вовсе.
    expect(read('components/settings/sla-intake-screen.tsx')).not.toContain('@/lib/db');
  });

  it('интервал задачи SLA стал настраиваемым', () => {
    const sla = ALL_SCHEDULES.find((s) => s.schedulerId === 'monitoring.slaEscalation.cron');
    expect(sla, 'расписание задачи SLA пропало из общего реестра').toBeDefined();
    expect(sla?.editable, 'расписание задачи SLA снова нельзя изменить из интерфейса').toBe(true);
  });

  it('воркер регистрирует задачу SLA по расписанию из базы', () => {
    const src = read('worker/index.ts');
    expect(src, 'воркер снова берёт расписание SLA только из кода').toMatch(
      /registerSlaEscalationSchedules\(getQueue, patterns\)/
    );
  });

  it('сохранение расписания допускает любую редактируемую задачу, а не только обмен', () => {
    const src = read('lib/services/admin/syncSchedules.ts');
    expect(src, 'задача SLA не пройдёт проверку — сохранить её расписание нельзя').toContain(
      'ALL_SCHEDULES.some((s) => s.editable && s.schedulerId === schedulerId)'
    );
  });
});
