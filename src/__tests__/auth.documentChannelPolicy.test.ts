import { describe, it, expect } from 'vitest';
import {
  organizationChannelWhere,
  partnerChannelWhere,
  documentInChannel
} from '@/lib/auth/documentChannelPolicy';

describe('documentChannelPolicy', () => {
  it('organizationChannelWhere pins the org channel and hides infected', () => {
    expect(organizationChannelWhere('org-1')).toEqual({
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      scanStatus: { not: 'infected' }
    });
  });

  it('partnerChannelWhere pins the partner channel and hides infected', () => {
    expect(partnerChannelWhere('p-1')).toEqual({
      counterpartyType: 'partner',
      counterpartyId: 'p-1',
      scanStatus: { not: 'infected' }
    });
  });

  it('documentInChannel matches type + id', () => {
    const doc = { counterpartyType: 'partner' as const, counterpartyId: 'p-1' };
    expect(documentInChannel(doc, { type: 'partner', id: 'p-1' })).toBe(true);
    expect(documentInChannel(doc, { type: 'partner', id: 'p-2' })).toBe(false);
    expect(documentInChannel(doc, { type: 'organization', id: 'p-1' })).toBe(false);
  });
});
