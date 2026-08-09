/**
 * `/partner/team` после этапа 4 (`У-60`) — тонкий шлюз.
 *
 * Раздел «Команда» переехал на вкладку настроек, но адрес остался: он живёт в
 * закладках и в старых письмах-приглашениях. Содержимое раздела проверяется
 * теперь в `pages.partner-settings`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));

import PartnerTeamPage from '@/app/partner/team/page';

beforeEach(() => {
  redirect.mockClear();
});

describe('PartnerTeamPage', () => {
  it('уводит на вкладку «Команда» в настройках', () => {
    expect(() => PartnerTeamPage()).toThrow('REDIRECT:/partner/settings?tab=team');
    expect(redirect).toHaveBeenCalledWith('/partner/settings?tab=team');
  });
});
