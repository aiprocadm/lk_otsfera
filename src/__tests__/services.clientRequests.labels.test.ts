/**
 * Unit tests for src/lib/services/clientRequests/labels.ts (этап 5, §9-3):
 * русские подписи статусов «подана → в работе → принята/отклонена».
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_REQUEST_STATUS_LABEL,
  clientRequestStatusLabel
} from '@/lib/services/clientRequests/labels';

describe('CLIENT_REQUEST_STATUS_LABEL', () => {
  it('все четыре статуса имеют русские подписи по спеке', () => {
    expect(CLIENT_REQUEST_STATUS_LABEL).toEqual({
      submitted: 'Подана',
      in_triage: 'В работе',
      converted: 'Принята',
      rejected: 'Отклонена'
    });
  });
});

describe('clientRequestStatusLabel', () => {
  it('возвращает подпись для каждого статуса', () => {
    expect(clientRequestStatusLabel('submitted')).toBe('Подана');
    expect(clientRequestStatusLabel('in_triage')).toBe('В работе');
    expect(clientRequestStatusLabel('converted')).toBe('Принята');
    expect(clientRequestStatusLabel('rejected')).toBe('Отклонена');
  });
});
