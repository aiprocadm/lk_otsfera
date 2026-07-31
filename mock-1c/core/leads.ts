type LeadBody = Record<string, unknown> & { cabinetLeadId?: unknown };

export type LeadAcceptResult =
  | { status: 200; result: { acceptedAt: string; oneCRequestId: string } }
  | { status: 400 | 500; result?: undefined };

export type LeadStoreState = {
  uniqueLeads: number;
  partnerKeyFieldsSeen: string[];
  lastBody: LeadBody | null;
};

const PARTNER_KEY_CANDIDATES = ['partnerSlug', 'partnerExternalId'];

export function createLeadStore() {
  const byLeadId = new Map<string, { acceptedAt: string; oneCRequestId: string }>();
  const partnerKeyFieldsSeen = new Set<string>();
  let lastBody: LeadBody | null = null;
  let counter = 0;

  return {
    accept(
      body: LeadBody,
      pushFailRate: number,
      now: () => Date = () => new Date()
    ): LeadAcceptResult {
      // Deterministic failure when rate >= 1; probabilistic otherwise (mock runtime only).
      if (pushFailRate >= 1 || (pushFailRate > 0 && Math.random() < pushFailRate)) {
        return { status: 500 };
      }
      const leadId = typeof body.cabinetLeadId === 'string' ? body.cabinetLeadId : '';
      if (!leadId) return { status: 400 };

      lastBody = body;
      for (const field of PARTNER_KEY_CANDIDATES) {
        if (field in body) partnerKeyFieldsSeen.add(field);
      }

      const existing = byLeadId.get(leadId);
      if (existing) return { status: 200, result: existing }; // idempotent dedup

      counter += 1;
      const result = { acceptedAt: now().toISOString(), oneCRequestId: `mock-req-${counter}` };
      byLeadId.set(leadId, result);
      return { status: 200, result };
    },
    state(): LeadStoreState {
      return {
        uniqueLeads: byLeadId.size,
        partnerKeyFieldsSeen: [...partnerKeyFieldsSeen],
        lastBody,
      };
    },
  };
}
