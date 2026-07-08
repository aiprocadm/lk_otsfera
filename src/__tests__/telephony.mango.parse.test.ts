import { describe, it, expect } from 'vitest';
import { parseMangoEvent } from '@/lib/telephony/mango/parse';

describe('parseMangoEvent — summary', () => {
  it('parses an inbound summary event with normalized phone', () => {
    const json = {
      entry_id: 'e1',
      call_direction: 1,
      from: { number: '+7 (999) 000-11-22' },
      to: { number: '100' },
      duration: 42,
    };
    const ev = parseMangoEvent('summary', json);
    expect(ev).toEqual({
      kind: 'summary',
      externalId: 'e1',
      direction: 'inbound',
      callerNumber: '+79990001122',
      internalNumber: '100',
      durationSec: 42,
      status: undefined,
    });
  });

  it('maps call_direction 2 → outbound', () => {
    const json = { entry_id: 'e2', call_direction: 2, from: { number: '+7 999 000 11 22' } };
    const ev = parseMangoEvent('summary', json);
    expect(ev).toMatchObject({ kind: 'summary', direction: 'outbound', callerNumber: '+79990001122' });
  });

  it('defaults to inbound when call_direction is missing/other', () => {
    const json = { entry_id: 'e3', from: { number: '+79990001122' } };
    const ev = parseMangoEvent('summary', json);
    expect(ev).toMatchObject({ kind: 'summary', direction: 'inbound' });
  });

  it('missing entry_id → null', () => {
    const json = { from: { number: '+79990001122' } };
    expect(parseMangoEvent('summary', json)).toBeNull();
  });

  it('missing caller number → null', () => {
    const json = { entry_id: 'e4' };
    expect(parseMangoEvent('summary', json)).toBeNull();
  });
});

describe('parseMangoEvent — recording', () => {
  it('Completed with recording_id → recording event', () => {
    const json = { entry_id: 'e5', recording_state: 'Completed', recording_id: 'rec-1' };
    const ev = parseMangoEvent('recording', json);
    expect(ev).toEqual({ kind: 'recording', externalId: 'e5', recordingId: 'rec-1' });
  });

  it('InProgress → null', () => {
    const json = { entry_id: 'e6', recording_state: 'InProgress', recording_id: 'rec-2' };
    expect(parseMangoEvent('recording', json)).toBeNull();
  });

  it('Completed without recording_id → null', () => {
    const json = { entry_id: 'e7', recording_state: 'Completed' };
    expect(parseMangoEvent('recording', json)).toBeNull();
  });
});

describe('parseMangoEvent — call', () => {
  it('in-progress call event → call kind with present fields', () => {
    const json = { entry_id: 'e8', call_state: 'Appeared', from: { number: '+79990001122' } };
    const ev = parseMangoEvent('call', json);
    expect(ev).toMatchObject({ kind: 'call', externalId: 'e8', callerNumber: '+79990001122' });
  });

  it('missing entry_id → null', () => {
    expect(parseMangoEvent('call', { from: { number: '+79990001122' } })).toBeNull();
  });
});

describe('parseMangoEvent — invalid input', () => {
  it('unknown type → null', () => {
    expect(parseMangoEvent('bogus', { entry_id: 'e9' })).toBeNull();
  });

  it('non-object json → null', () => {
    expect(parseMangoEvent('summary', null)).toBeNull();
    expect(parseMangoEvent('summary', 'string')).toBeNull();
    expect(parseMangoEvent('summary', 42)).toBeNull();
  });

  it('missing entry_id on any known type → null', () => {
    expect(parseMangoEvent('summary', { from: { number: '1' } })).toBeNull();
    expect(parseMangoEvent('recording', { recording_state: 'Completed', recording_id: 'r' })).toBeNull();
    expect(parseMangoEvent('call', {})).toBeNull();
  });
});
