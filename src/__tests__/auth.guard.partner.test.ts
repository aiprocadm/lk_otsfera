import { describe, it, expect } from 'vitest';
import { requirePartner, requirePartnerAdmin } from '@/lib/auth/guard';
import type { SessionPayload } from '@/lib/auth/jwt';

const adminPartner: SessionPayload = {
  sub: 'u1', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
};

const managerPartner: SessionPayload = {
  sub: 'u2', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: []
};

const platformAdmin: SessionPayload = { sub: 'u3', role: 'admin' };

const orgUser: SessionPayload = { sub: 'u4', role: 'organization', organizationId: 'o1' };

describe('requirePartner', () => {
  it('passes for partner session with partnerId', () => {
    const r = requirePartner(adminPartner);
    expect(r.ok).toBe(true);
  });

  it('forbids non-partner roles', async () => {
    const r = requirePartner(orgUser);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it('forbids partner without partnerId', async () => {
    const r = requirePartner({ ...adminPartner, partnerId: null });
    expect(r.ok).toBe(false);
  });

  it('forbids platform admin (we want partner-scoped only)', () => {
    const r = requirePartner(platformAdmin);
    expect(r.ok).toBe(false);
  });
});

describe('requirePartnerAdmin', () => {
  it('passes for partner with partnerRole=admin', () => {
    const r = requirePartnerAdmin(adminPartner);
    expect(r.ok).toBe(true);
  });

  it('forbids partner manager', async () => {
    const r = requirePartnerAdmin(managerPartner);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it('forbids platform admin', () => {
    const r = requirePartnerAdmin(platformAdmin);
    expect(r.ok).toBe(false);
  });
});
