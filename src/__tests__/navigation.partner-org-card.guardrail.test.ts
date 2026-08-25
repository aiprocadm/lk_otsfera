import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: () => true }));

import { partnerOrgTabHref } from '@/lib/navigation/partnerOrgCard';
import { orgCardTabsFor } from '@/lib/navigation/orgCardTabs';

/**
 * Страж партнёрской карточки (`У-96`, §0.2 — правило зеркала).
 *
 * У партнёра был **свой** список вкладок из пяти ключей, две из которых —
 * отдельные страницы. Из-за этого один и тот же объект в его кабинете выглядел
 * иначе, чем у всех: «Заказов», «Обзора» и «Заявок на обучение» не было вовсе,
 * а журнал действий учебного центра, наоборот, показывался.
 *
 * Страж держит две вещи: свой список вкладок не вернулся, и ни одна вкладка
 * реестра не ведёт в никуда.
 */
const SRC = join(process.cwd(), 'src');
const APP = join(SRC, 'app');

describe('партнёрская карточка на общем реестре (У-96)', () => {
  it('своего списка вкладок у партнёра больше нет', () => {
    expect(existsSync(join(SRC, 'components/partner/org-tabs.tsx'))).toBe(false);
    for (const file of [
      'app/partner/portfolio/[orgId]/page.tsx',
      'app/partner/portfolio/[orgId]/documents/page.tsx',
      'app/partner/portfolio/[orgId]/settings/page.tsx',
    ]) {
      const src = readFileSync(join(SRC, file), 'utf8');
      expect(src, file).toContain('orgCardTabsFor');
      expect(src, file).not.toContain("from '@/components/partner/org-tabs'");
    }
  });

  it('каждая вкладка реестра ведёт либо на карточку, либо на существующую страницу', () => {
    for (const tab of orgCardTabsFor('partner', { flags: () => true })) {
      const href = partnerOrgTabHref('org-1', tab.key);
      if (href.includes('?tab=')) {
        expect(href, tab.key).toBe(`/partner/portfolio/org-1?tab=${tab.key}`);
        continue;
      }
      // Собственная страница обязана существовать — иначе вкладка это 404.
      const rel = href.replace('/partner/portfolio/org-1/', '');
      expect(
        existsSync(join(APP, 'partner/portfolio/[orgId]', rel, 'page.tsx')),
        `вкладка «${tab.label}» ведёт на ${href}, а страницы нет`
      ).toBe(true);
    }
  });

  it('партнёру не показывают внутренние вкладки учебного центра', () => {
    const keys = orgCardTabsFor('partner', { flags: () => true }).map((t) => t.key);
    for (const forbidden of ['payments', 'leads', 'deals', 'calls', 'inbound', 'history']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it('данные карточки партнёру даёт общий сервис, а не свой', () => {
    // `getOrgCard` остаётся только у экранов с собственным содержимым
    // (документы, настройки) — сама карточка живёт на общем сервисе.
    const card = readFileSync(join(SRC, 'app/partner/portfolio/[orgId]/page.tsx'), 'utf8');
    expect(card).toContain('getOrganizationCard');
    expect(card).not.toContain('getOrgCard');
  });
});
