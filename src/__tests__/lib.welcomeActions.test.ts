/**
 * Unit tests for src/lib/welcomeActions.ts (этап 4, ФТ-10.4, решение §8-3):
 * состав карточек welcome-блока по фича-флагам enrollment_requests /
 * certificates_registry, фолбэки «Заказы|Портфель» и «Финансы», всегда ровно 3.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

import { welcomeActionsFor } from '@/lib/welcomeActions';

function setFlags(flags: Partial<Record<string, boolean>>) {
  isFeatureEnabled.mockImplementation((flag: string) => flags[flag] === true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('welcomeActionsFor — оба флага включены', () => {
  beforeEach(() => setFlags({ enrollment_requests: true, certificates_registry: true }));

  it('organization: заявка / удостоверения / документы с правильными href', () => {
    const actions = welcomeActionsFor('organization');
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.href)).toEqual([
      '/organization/enrollments',
      '/organization/certificates',
      '/organization/documents'
    ]);
    expect(actions.map((a) => a.title)).toEqual([
      'Подать заявку на обучение',
      'Удостоверения',
      'Документы'
    ]);
  });

  it('partner: те же карточки на партнёрских путях', () => {
    const actions = welcomeActionsFor('partner');
    expect(actions.map((a) => a.href)).toEqual([
      '/partner/enrollments',
      '/partner/certificates',
      '/partner/documents'
    ]);
  });
});

describe('welcomeActionsFor — оба флага выключены (фолбэки)', () => {
  beforeEach(() => setFlags({}));

  it('organization: Документы + Заказы + Финансы', () => {
    const actions = welcomeActionsFor('organization');
    expect(actions.map((a) => [a.title, a.href])).toEqual([
      ['Документы', '/organization/documents'],
      ['Заказы', '/organization/orders'],
      ['Финансы', '/organization/finance']
    ]);
  });

  it('partner: Документы + Портфель + Финансы', () => {
    const actions = welcomeActionsFor('partner');
    expect(actions.map((a) => [a.title, a.href])).toEqual([
      ['Документы', '/partner/documents'],
      ['Портфель', '/partner/portfolio'],
      ['Финансы', '/partner/finance']
    ]);
  });
});

describe('welcomeActionsFor — один флаг включён (один фолбэк)', () => {
  it('только enrollment_requests: заявка / документы / первый фолбэк', () => {
    setFlags({ enrollment_requests: true });
    const org = welcomeActionsFor('organization');
    expect(org.map((a) => a.title)).toEqual(['Подать заявку на обучение', 'Документы', 'Заказы']);
    const partner = welcomeActionsFor('partner');
    expect(partner.map((a) => a.title)).toEqual([
      'Подать заявку на обучение',
      'Документы',
      'Портфель'
    ]);
  });

  it('только certificates_registry: удостоверения / документы / первый фолбэк', () => {
    setFlags({ certificates_registry: true });
    const org = welcomeActionsFor('organization');
    expect(org.map((a) => [a.title, a.href])).toEqual([
      ['Удостоверения', '/organization/certificates'],
      ['Документы', '/organization/documents'],
      ['Заказы', '/organization/orders']
    ]);
  });
});

describe('welcomeActionsFor — инварианты', () => {
  it('всегда ровно 3 карточки при любой комбинации флагов и ролей', () => {
    for (const enrollment of [true, false]) {
      for (const certificates of [true, false]) {
        setFlags({ enrollment_requests: enrollment, certificates_registry: certificates });
        for (const role of ['organization', 'partner'] as const) {
          const actions = welcomeActionsFor(role);
          expect(actions).toHaveLength(3);
          // Все href живут в кабинете своей роли, у каждой карточки есть hint.
          for (const a of actions) {
            expect(a.href.startsWith(`/${role}/`)).toBe(true);
            expect(a.hint.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('карточка «Документы» присутствует всегда', () => {
    for (const flags of [{}, { enrollment_requests: true }, { certificates_registry: true }]) {
      setFlags(flags);
      expect(welcomeActionsFor('organization').some((a) => a.title === 'Документы')).toBe(true);
      expect(welcomeActionsFor('partner').some((a) => a.title === 'Документы')).toBe(true);
    }
  });
});
