/**
 * Добор покрытия по группе «lib-misc» (см. программу погашения coverage-долга).
 * Здесь живут только те проверки, которых не хватало для 100% по четырём
 * метрикам; каждая утверждает поведение, а не «дёргает строку ради процента».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSession }));

const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

import { withAuth } from '@/lib/api/withAuth';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  buildSettingsBreadcrumbs,
} from '@/lib/navigation/settings';

const session = { sub: 'u1', role: 'admin' } as SessionPayload;

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  requireSession.mockResolvedValue({ ok: true, value: session });
});

describe('withAuth — вызов роута без второго аргумента', () => {
  // Next 15 требует, чтобы в ТИПЕ второй аргумент был обязательным, но рантайм
  // терпим к его отсутствию: юнит-тесты роутов зовут обработчик одним аргументом.
  // Именно этот путь включает запасной `?? Promise.resolve({})`.
  it('params превращаются в пустой объект, а обработчик всё равно отрабатывает', async () => {
    const seen: Array<Record<string, string>> = [];
    const handler = withAuth({}, async ({ params }) => {
      seen.push(await params);
      return Response.json({ ok: true });
    });

    const callWithoutCtx = handler as unknown as (req: Request) => Promise<Response>;
    const res = await callWithoutCtx(new Request('http://x', { method: 'POST', body: null }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen).toEqual([{}]);
  });
});

describe('реестр настроек — инвариант групп', () => {
  // Этот инвариант — обоснование v8-ignore на `group?.title ?? ''` в
  // buildSettingsBreadcrumbs: группа всегда находится, ветки-пустышки не бывает.
  it('у каждого раздела есть своя группа в SETTINGS_GROUPS', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    const orphans = SETTINGS_SECTIONS.filter((s) => !groupIds.has(s.group)).map((s) => s.id);
    expect(orphans).toEqual([]);
  });

  it('крошки подраздела всегда несут непустое название группы', () => {
    const withCabinet = SETTINGS_SECTIONS.flatMap((section) =>
      section.cabinets.map((cabinet) => ({ section, cabinet }))
    );
    expect(withCabinet.length).toBeGreaterThan(0);

    for (const { section, cabinet } of withCabinet) {
      const crumbs = buildSettingsBreadcrumbs(cabinet, `/${cabinet}/settings/${section.path}`);
      expect(crumbs).toHaveLength(3);
      expect(crumbs[1]!.label).not.toBe('');
      expect(crumbs[1]!.href).toBeNull();
      expect(crumbs[2]!.label).toBe(section.title);
    }
  });
});
