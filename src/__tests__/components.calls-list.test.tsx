// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
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
  hasRecording: false
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
    const html = renderToString(<CallsFiltersBar direction='inbound' />);
    const inboundIdx = html.indexOf('Входящие');
    const highlighted = html.slice(0, inboundIdx).lastIndexOf('bg-[#F97316]');
    expect(highlighted).toBeGreaterThan(-1);
  });
});
