import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

import { listFeatureFlags, setFeatureFlag } from '@/lib/services/admin/featureFlags';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { resetFeatureFlagCache, featureSettingKey } from '@/lib/config/featureFlagStore';

/**
 * Этап 8 (`У-65`…`У-67`) на живом Postgres.
 *
 * Главное, что проверяется здесь и нигде больше: **приоритет источников**
 * «база → переменная окружения → умолчание» и то, что синхронная
 * `isFeatureEnabled` действительно видит значение из базы. Юнит-тесты этого не
 * покажут: там нет ни таблицы, ни снапшота.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();
const USER_ID = `st8-admin-${STAMP}`;
const admin = { sub: USER_ID, role: 'admin' } as never;
const manager = { sub: USER_ID, role: 'manager', managedOrgIds: [] } as never;

/** Поведенческий флаг (не закрывает раздел) — его и переключаем. */
const FLAG = 'document_generation';
const ROUTE_FLAG = 'manager_cabinet';

beforeAll(async () => {
  await prisma.user.create({
    data: { id: USER_ID, email: `${USER_ID}@t.test`, name: 'Stage8 Admin', role: 'admin' },
  });
});

afterAll(async () => {
  await prisma.integrationSetting.deleteMany({ where: { key: { startsWith: 'feature.' } } });
  await prisma.auditLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
  resetFeatureFlagCache();
});

beforeEach(async () => {
  await prisma.integrationSetting.deleteMany({ where: { key: { startsWith: 'feature.' } } });
  delete process.env[`FEATURE_${FLAG.toUpperCase()}`];
  resetFeatureFlagCache();
});

describe('этап 8 — флаги из интерфейса (живой Postgres)', () => {
  it('У-66: база перекрывает окружение, а сброс возвращает окружение', async () => {
    // Умолчание: opt-in флаг выключен, пока его не включили.
    await listFeatureFlags(prisma, admin);
    expect(isFeatureEnabled(FLAG)).toBe(false);

    // Окружение включает.
    process.env[`FEATURE_${FLAG.toUpperCase()}`] = '1';
    resetFeatureFlagCache();
    await listFeatureFlags(prisma, admin);
    expect(isFeatureEnabled(FLAG)).toBe(true);

    // База перекрывает окружение — это и есть `У-66`.
    const off = await setFeatureFlag(prisma, admin, { flag: FLAG, enabled: false });
    expect(off).toMatchObject({ ok: true, enabled: false, source: 'ui' });
    expect(isFeatureEnabled(FLAG)).toBe(false);

    // Сброс убирает строку — значение снова берётся из окружения.
    const reset = await setFeatureFlag(prisma, admin, { flag: FLAG, enabled: null });
    expect(reset).toMatchObject({ ok: true, enabled: true, source: 'env' });
    expect(await prisma.integrationSetting.count({ where: { key: featureSettingKey(FLAG) } })).toBe(
      0
    );
  });

  it('У-67: переключение пишет в журнал, из чего во что', async () => {
    await setFeatureFlag(prisma, admin, { flag: FLAG, enabled: true });
    const audit = await prisma.auditLog.findFirst({
      where: { userId: USER_ID, action: 'feature_flag.changed', entityId: FLAG },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const meta = audit!.meta as { before?: { enabled?: boolean }; after?: { enabled?: boolean } };
    expect(meta.before?.enabled).toBe(false);
    expect(meta.after?.enabled).toBe(true);
  });

  it('У-65: флаг, закрывающий раздел, не переключается — и это запрет сервера', async () => {
    // Скрытой кнопки мало: middleware читает такой флаг в edge-среде, где базы
    // нет, и включение из интерфейса было бы иллюзией управления.
    expect(await setFeatureFlag(prisma, admin, { flag: ROUTE_FLAG, enabled: true })).toEqual({
      ok: false,
      error: 'not_editable',
    });
    expect(
      await prisma.integrationSetting.count({ where: { key: featureSettingKey(ROUTE_FLAG) } })
    ).toBe(0);
  });

  it('права: не-админ ничего не видит и ничего не переключает', async () => {
    expect(await listFeatureFlags(prisma, manager)).toEqual({ ok: false, error: 'forbidden' });
    expect(await setFeatureFlag(prisma, manager, { flag: FLAG, enabled: true })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('несуществующий флаг отвергается, а не заводит мусорную строку', async () => {
    expect(await setFeatureFlag(prisma, admin, { flag: 'no_such_flag', enabled: true })).toEqual({
      ok: false,
      error: 'unknown_flag',
    });
    expect(await prisma.integrationSetting.count({ where: { key: 'feature.no_such_flag' } })).toBe(
      0
    );
  });

  it('список показывает источник и то, какие флаги редактируемы', async () => {
    await setFeatureFlag(prisma, admin, { flag: FLAG, enabled: true });
    const res = await listFeatureFlags(prisma, admin);
    if (!res.ok) throw new Error('expected ok');

    const edited = res.rows.find((r) => r.flag === FLAG);
    expect(edited).toMatchObject({ source: 'ui', editable: true, enabled: true });

    const routeGated = res.rows.find((r) => r.flag === ROUTE_FLAG);
    expect(routeGated?.editable).toBe(false);

    // `У-68`: опасные помечены — интерфейс обязан спросить подтверждение.
    expect(res.rows.find((r) => r.flag === 'pii_access_log')?.sensitive).toBe(true);
    expect(res.rows.find((r) => r.flag === 'pwa_installer')?.sensitive).toBe(false);
  });
});
