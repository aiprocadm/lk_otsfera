// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
vi.mock('@/components/intake/source-intake-actions', () => ({
  SourceIntakeActions: (props: {
    kind: string;
    sourceId: string;
    leadPrefill: Record<string, string>;
    taskTitle: string;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'intake-actions' },
      `${props.kind}:${props.sourceId}:${props.leadPrefill.contactPhone}:${props.taskTitle}`
    ),
}));

import { CallsList, type CallListItem } from '@/components/manager/calls-list';
import { CallsFiltersBar } from '@/components/manager/calls-filters';

const base: CallListItem = {
  id: 'call-1',
  direction: 'inbound',
  callerNumber: '+79990001122',
  internalNumber: '101',
  status: 'answered',
  durationSec: 125,
  startedAt: new Date('2026-07-01T10:00:00Z'),
  createdAt: new Date('2026-07-01T10:00:05Z'),
  resolvedOrgId: null,
  recordingScanStatus: 'none',
  hasRecording: false,
};

describe('CallsList', () => {
  it('пустой список → EmptyState', () => {
    const html = renderToString(<CallsList items={[]} />);
    expect(html).toContain('Звонков нет');
  });

  it('рендерит строку: направление, номер, внутренний, длительность mm:ss', () => {
    const html = renderToString(<CallsList items={[base]} />);
    expect(html).toContain('Входящий');
    expect(html).toContain('+79990001122');
    expect(html).toContain('101');
    expect(html).toContain('02:05');
  });

  it('неизвестное направление падает в fallback-лейбл и neutral-тон', () => {
    const html = renderToString(<CallsList items={[{ ...base, direction: 'weird' }]} />);
    expect(html).toContain('weird');
  });

  it('outbound использует info-тон и «Исходящий»', () => {
    const html = renderToString(<CallsList items={[{ ...base, direction: 'outbound' }]} />);
    expect(html).toContain('Исходящий');
  });

  it('internalNumber=null → тире в таблице и без блока «Внутр.» в мобильной карточке', () => {
    const html = renderToString(<CallsList items={[{ ...base, internalNumber: null }]} />);
    expect(html).toContain('—');
    expect(html).not.toContain('Внутр.:');
  });

  it('длительность: null/NaN/отрицательная → тире', () => {
    for (const durationSec of [null, Number.NaN, -5]) {
      const html = renderToString(<CallsList items={[{ ...base, durationSec }]} />);
      expect(html).toContain('—');
    }
  });

  describe('RecordingCell (clean-gate)', () => {
    it('hasRecording=false → «Нет записи», без ссылки', () => {
      const html = renderToString(<CallsList items={[{ ...base, hasRecording: false }]} />);
      expect(html).toContain('Нет записи');
      expect(html).not.toContain('/api/manager/calls/');
    });

    it('infected → бейдж «Заражено», без ссылки (410-семантика)', () => {
      const html = renderToString(
        <CallsList items={[{ ...base, hasRecording: true, recordingScanStatus: 'infected' }]} />
      );
      expect(html).toContain('Заражено');
      expect(html).not.toContain('/api/manager/calls/');
    });

    it('clean → ссылка «Прослушать» на recording-роут (никогда не raw path)', () => {
      const html = renderToString(
        <CallsList items={[{ ...base, hasRecording: true, recordingScanStatus: 'clean' }]} />
      );
      expect(html).toContain('Прослушать');
      expect(html).toContain('/api/manager/calls/call-1/recording');
    });

    it('pending → «Проверяется»', () => {
      const html = renderToString(
        <CallsList items={[{ ...base, hasRecording: true, recordingScanStatus: 'pending' }]} />
      );
      expect(html).toContain('Проверяется');
    });
  });
});

describe('CallsList — call-triage (Task 10)', () => {
  const unresolved: CallListItem = { ...base, id: 'call-unresolved', resolvedOrgId: null };
  const resolved: CallListItem = { ...base, id: 'call-resolved', resolvedOrgId: 'org-1' };
  const orgs = [{ id: 'o1', name: 'ООО Ромашка' }];

  it('contactsEnabled=false → без формы привязки и без колонки «Привязка», даже для нераспознанного звонка', () => {
    const html = renderToString(
      <CallsList items={[unresolved]} orgs={orgs} contactsEnabled={false} />
    );
    expect(html).not.toContain('Привязка');
    expect(html).not.toContain('Создать контакт из номера');
  });

  it('contactsEnabled=true + resolvedOrgId=null → рендерит CallBindForm (кнопки привязки)', () => {
    const html = renderToString(
      <CallsList items={[unresolved]} orgs={orgs} contactsEnabled={true} />
    );
    expect(html).toContain('Привязка');
    expect(html).toContain('Создать контакт из номера');
  });

  it('contactsEnabled=true + resolvedOrgId!=null → звонок read-only («Привязан»), без формы', () => {
    const html = renderToString(
      <CallsList items={[resolved]} orgs={orgs} contactsEnabled={true} />
    );
    expect(html).toContain('Привязан');
    expect(html).not.toContain('Создать контакт из номера');
  });
});

describe('CallsFiltersBar', () => {
  it('без direction активна «Все», ссылки строятся на оба направления', () => {
    const html = renderToString(<CallsFiltersBar />);
    expect(html).toContain('Все');
    expect(html).toContain('/manager/calls?direction=inbound');
    expect(html).toContain('/manager/calls?direction=outbound');
    // «Все» без query-строки
    expect(html).toContain('href="/manager/calls"');
  });

  it('активное направление подсвечено брендовым фоном', () => {
    const html = renderToString(<CallsFiltersBar direction="inbound" />);
    const inboundIdx = html.indexOf('Входящие');
    const highlighted = html.slice(0, inboundIdx).lastIndexOf('bg-[#F97316]');
    expect(highlighted).toBeGreaterThan(-1);
  });

  it('с orgId ссылки направлений сохраняют orgId, «Все» — тоже (только без direction)', () => {
    const html = renderToString(<CallsFiltersBar orgId="org-1" />);
    expect(html).toContain('/manager/calls?direction=inbound&amp;orgId=org-1');
    expect(html).toContain('/manager/calls?direction=outbound&amp;orgId=org-1');
    expect(html).toContain('href="/manager/calls?orgId=org-1"');
  });

  it('рендерит children — слот под дополнительные фильтры внутри бара', () => {
    const html = renderToString(
      <CallsFiltersBar direction="inbound">
        <div>ORG_FILTER_SLOT</div>
      </CallsFiltersBar>
    );
    expect(html).toContain('ORG_FILTER_SLOT');
  });
});

describe('CallsList — интейк-действия (этап 7)', () => {
  it('входящий звонок при currentUserId получает кнопки с префиллом номера', () => {
    // «Создать лид»/«Задача» прямо из журнала звонков. Номер обязан переехать
    // в префилл — менеджер не должен перепечатывать его из соседней колонки.
    const html = renderToString(
      React.createElement(CallsList, { items: [base], currentUserId: 'm1' })
    );
    expect(html).toContain('data-testid="intake-actions"');
    expect(html).toContain('call:call-1:+79990001122:Перезвонить: +79990001122');
  });

  it('исходящий звонок — прочерк вместо кнопок (лид создают из входящих)', () => {
    const outbound = { ...base, id: 'call-2', direction: 'outbound' as const };
    const html = renderToString(
      React.createElement(CallsList, { items: [outbound], currentUserId: 'm1' })
    );
    expect(html).not.toContain('data-testid="intake-actions"');
    expect(html).toContain('—');
  });

  it('без currentUserId колонки «Действия» нет вовсе', () => {
    const html = renderToString(React.createElement(CallsList, { items: [base] }));
    expect(html).not.toContain('Действия');
    expect(html).not.toContain('data-testid="intake-actions"');
  });
});
