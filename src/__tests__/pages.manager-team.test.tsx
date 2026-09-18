import { describe, it, expect, vi, beforeEach } from 'vitest';
import ManagerTeamPage from '@/app/manager/team/page';

/**
 * `/manager/team` — шлюз на переехавший раздел.
 *
 * До `У-262` страница была развилкой: при включённом `leader_cabinet` она
 * уводила в кабинет руководителя, при выключенном показывала прежнее
 * содержимое (переключатель видимости + список менеджеров). Флаг снят, ветка
 * «по-старому» удалена целиком — оставлять её значило бы держать в коде и в
 * покрытии путь, по которому никто уже не пройдёт.
 *
 * Осталось два обязательства, и оба проверяются ниже: авторизация (без неё
 * адрес рассказывал бы гостю, куда переехал раздел) и **постоянный** редирект
 * — адрес переехал насовсем.
 */
const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

const nav = vi.hoisted(() => ({
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`PERMANENT_REDIRECT:${url}`);
  }),
}));
vi.mock('next/navigation', () => nav);

const SESSION = { sub: 'u1', role: 'leader' as const, companyId: 'c1' };

describe('ManagerTeamPage — шлюз на /leader/team (У-262)', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    nav.permanentRedirect.mockClear();
  });

  it('уводит в кабинет руководителя постоянным редиректом', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);

    await expect(ManagerTeamPage()).rejects.toThrow('PERMANENT_REDIRECT:/leader/team');
    expect(nav.permanentRedirect).toHaveBeenCalledWith('/leader/team');
  });

  it('сначала авторизация, потом редирект', async () => {
    // Порядок важен: иначе адрес отвечал бы гостю, куда переехал раздел.
    requireManagerLeader.mockRejectedValue(new Error('NOT_AUTHORIZED'));

    await expect(ManagerTeamPage()).rejects.toThrow('NOT_AUTHORIZED');
    expect(nav.permanentRedirect).not.toHaveBeenCalled();
  });
});
