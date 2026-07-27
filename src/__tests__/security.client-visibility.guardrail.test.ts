import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Этап 10 (ТЗ §3.2 + §7) guardrail: клиентский контур не знает о внутреннем.
 *
 * Решение заказчика 27.07.2026: «партнёр вообще не должен видеть лидов и
 * организация тоже, это только внутренний процесс». Тест ловит регресс —
 * возврат домена лидов в кабинеты и просачивание запрещённых §7 полей в
 * клиентские сервисы/страницы.
 *
 * Ограничение (осознанное): проверяются исходники клиентского контура, а не
 * рантайм. Новый способ утечки через staff-роут этим тестом не ловится — его
 * ловят негативные интеграционные тесты (PR-2) и матрица
 * `docs/audit/2026-07-27-client-visibility-matrix.md`.
 */

const ROOT = process.cwd();

/** Пути клиентского контура: кабинеты, их API и сервисы. */
const CLIENT_DIRS = [
  'src/app/partner',
  'src/app/organization',
  'src/app/api/partner',
  'src/app/api/organization',
  'src/lib/services/partner',
  'src/lib/services/organization',
  'src/server-actions/partner',
  'src/server-actions/organization'
];

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = path.join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...walk(path.join(dir, entry)));
    else if (/\.tsx?$/.test(entry)) out.push(path.join(dir, entry));
  }
  return out;
}

const CLIENT_FILES = CLIENT_DIRS.flatMap(walk);

describe('клиентский контур не содержит домена лидов (ТЗ §3.2)', () => {
  it('удалённые поверхности лидов не вернулись', () => {
    const forbidden = [
      'src/app/partner/leads',
      'src/app/api/partner/leads',
      'src/lib/services/partner/leads.ts',
      'src/lib/services/partner/leadAttachments.ts'
    ];
    const resurrected = forbidden.filter((f) => existsSync(path.join(ROOT, f)));
    expect(
      resurrected,
      `Домен лидов вернулся в клиентский кабинет (ТЗ §3.2 запрещает):\n  ${resurrected.join('\n  ')}`
    ).toEqual([]);
  });

  it('клиентские файлы не ссылаются на маршруты лидов', () => {
    const offenders = CLIENT_FILES.filter((f) =>
      readFileSync(path.join(ROOT, f), 'utf8').includes('/partner/leads')
    );
    expect(offenders, `Ссылка на удалённый раздел лидов:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('флаг partner_leads не воскрешён', () => {
    const flags = readFileSync(path.join(ROOT, 'src/lib/featureFlags.ts'), 'utf8');
    expect(flags).not.toContain("'partner_leads'");
  });
});

describe('клиентские сервисы не отдают запрещённые §7 поля', () => {
  // Поля из матрицы §7 ТЗ со столбцами «Партнёр: нет» / «Организация: нет».
  const FORBIDDEN_FIELDS = [
    'assignedManagerId',
    'assignedManagerName',
    'funnelStageId',
    'promotedDealId',
    'sourceInboundId',
    'sourceCallId'
  ];

  const SERVICE_FILES = CLIENT_FILES.filter((f) => f.startsWith('src/lib/services/'));

  it.each(FORBIDDEN_FIELDS)('поле %s не встречается в клиентских сервисах', (field) => {
    const offenders = SERVICE_FILES.filter((f) =>
      readFileSync(path.join(ROOT, f), 'utf8').includes(field)
    );
    expect(
      offenders,
      `§7 ТЗ: поле «${field}» — внутреннее, клиенту не отдаётся. Найдено в:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('клиентские сервисы не читают модель Deal напрямую', () => {
    const offenders = SERVICE_FILES.filter((f) => {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      return /prisma\.deal\.|tx\.deal\./.test(src);
    });
    expect(
      offenders,
      `§7 ТЗ: сделки — внутренний контур. Прямое чтение Deal в:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('passwordHash не объявлен в клиентских DTO и не возвращается наружу', () => {
    // Выбирать hash ради признака `invitePending` можно (он не покидает
    // сервис). Нельзя — объявлять его в типе выдачи или класть в возвращаемый
    // объект: тогда он уедет клиенту.
    const offenders = SERVICE_FILES.filter((f) => {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      const declaredInDto = /passwordHash\??:\s*(string|boolean)/.test(src);
      const returnedRaw = /\n\s*passwordHash,/.test(src);
      return declaredInDto || returnedRaw;
    });
    expect(
      offenders,
      `passwordHash не должен быть частью клиентского DTO:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('клиентские сервисы не читают внутренние заметки сделок (DealNote)', () => {
    const offenders = SERVICE_FILES.filter((f) =>
      /prisma\.dealNote\.|tx\.dealNote\./.test(readFileSync(path.join(ROOT, f), 'utf8'))
    );
    expect(offenders, `§7 ТЗ: DealNote — внутренние заметки:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
