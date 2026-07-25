import { describe, it, expect } from 'vitest';
import { DEFAULT_FUNNEL_STAGES, stageForLead } from '@/lib/funnel/stages';

describe('DEFAULT_FUNNEL_STAGES', () => {
  it('6 стадий: 3 рабочих + 3 терминальных, позиции 0..5 (этап 6: + promoted_to_deal)', () => {
    expect(DEFAULT_FUNNEL_STAGES.map((s) => s.statusAnchor)).toEqual([
      'new',
      'in_review',
      'qualified',
      'promoted_to_order',
      'promoted_to_deal',
      'rejected'
    ]);
    expect(DEFAULT_FUNNEL_STAGES.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(DEFAULT_FUNNEL_STAGES.filter((s) => s.isTerminal).map((s) => s.statusAnchor)).toEqual([
      'promoted_to_order',
      'promoted_to_deal',
      'rejected'
    ]);
  });
});

describe('stageForLead', () => {
  const stages = DEFAULT_FUNNEL_STAGES.map((s) => ({ ...s }));

  it('явный funnelStageId, существующий в наборе', () => {
    expect(stageForLead(stages, { status: 'new', funnelStageId: 'default:qualified' })?.id).toBe('default:qualified');
  });

  it('funnelStageId отсутствует в наборе → дефолт по якорю status', () => {
    expect(stageForLead(stages, { status: 'in_review', funnelStageId: 'stale-id' })?.id).toBe('default:in_review');
  });

  it('funnelStageId=null → дефолт по якорю status', () => {
    expect(stageForLead(stages, { status: 'rejected', funnelStageId: null })?.id).toBe('default:rejected');
  });
});
