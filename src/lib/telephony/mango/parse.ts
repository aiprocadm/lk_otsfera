import { normalizePhone } from '@/lib/services/inbound/resolve';

export type MangoEvent =
  | { kind: 'call'; externalId: string; direction?: 'inbound' | 'outbound'; callerNumber?: string; internalNumber?: string; status?: string }
  | {
      kind: 'summary';
      externalId: string;
      direction: 'inbound' | 'outbound';
      callerNumber: string;
      internalNumber?: string;
      durationSec?: number;
      status?: string;
    }
  | { kind: 'recording'; externalId: string; recordingId: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' ? v : undefined;
}

function nestedNumber(obj: Record<string, unknown>, key: string): string | undefined {
  const nested = obj[key];
  if (!isRecord(nested)) return undefined;
  return stringField(nested, 'number');
}

/** call_direction: Mango sends 1=inbound, 2=outbound; anything else/missing defaults to 'inbound'. */
function directionFrom(obj: Record<string, unknown>): 'inbound' | 'outbound' {
  return numberField(obj, 'call_direction') === 2 ? 'outbound' : 'inbound';
}

/**
 * Pure parser for Mango Office webhook events. Defensive by construction:
 * any missing required field returns `null` instead of throwing, since this
 * runs directly against untrusted webhook payloads.
 */
export function parseMangoEvent(type: string, json: unknown): MangoEvent | null {
  if (!isRecord(json)) return null;
  const externalId = stringField(json, 'entry_id');
  if (!externalId) return null;

  if (type === 'summary') {
    const rawCaller = nestedNumber(json, 'from');
    if (!rawCaller) return null;
    const callerNumber = normalizePhone(rawCaller);
    if (!callerNumber) return null;
    const internalRaw = nestedNumber(json, 'to');
    return {
      kind: 'summary',
      externalId,
      direction: directionFrom(json),
      callerNumber,
      internalNumber: internalRaw ?? undefined,
      durationSec: numberField(json, 'duration'),
      status: stringField(json, 'status'),
    };
  }

  if (type === 'recording') {
    if (stringField(json, 'recording_state') !== 'Completed') return null;
    const recordingId = stringField(json, 'recording_id');
    if (!recordingId) return null;
    return { kind: 'recording', externalId, recordingId };
  }

  if (type === 'call') {
    const rawCaller = nestedNumber(json, 'from');
    const internalRaw = nestedNumber(json, 'to');
    const callDirection = json['call_direction'];
    return {
      kind: 'call',
      externalId,
      direction: callDirection === undefined ? undefined : directionFrom(json),
      callerNumber: rawCaller ? normalizePhone(rawCaller) : undefined,
      internalNumber: internalRaw ?? undefined,
      status: stringField(json, 'call_state') ?? stringField(json, 'status'),
    };
  }

  return null;
}
