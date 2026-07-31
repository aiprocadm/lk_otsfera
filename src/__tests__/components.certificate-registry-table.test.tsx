import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  CertificateRegistryTable,
  type CertificateRegistryRow,
} from '@/components/certificates/certificate-registry-table';
import {
  CertificateRegistryFilters,
  CERTIFICATE_STATUS_OPTIONS,
} from '@/components/certificates/certificate-registry-filters';

/**
 * Этап 3 PR-1 (ФТ-6.1/6.2): таблица клиентского реестра (колонка организации,
 * ссылка на карточку, скан/«скан готовится», бессрочно) и GET-форма фильтров.
 */

const row = (over: Partial<CertificateRegistryRow> = {}): CertificateRegistryRow => ({
  id: 'c1',
  number: 'УД-001',
  issuedAt: new Date('2026-01-10'),
  validUntil: new Date('2026-02-01'),
  documentId: 'doc1',
  student: { id: 's1', name: 'Иванов Иван' },
  direction: { name: 'Охрана труда' },
  organization: { id: 'org1', name: 'ООО Ромашка' },
  ...over,
});

describe('CertificateRegistryTable', () => {
  it('пустой список → EmptyState', () => {
    const html = renderToString(<CertificateRegistryTable rows={[]} />);
    expect(html).toContain('Удостоверений не найдено');
  });

  it('базовая строка: номер, направление, скан-кнопка; организация скрыта, ФИО без ссылки', () => {
    const html = renderToString(<CertificateRegistryTable rows={[row()]} />);
    expect(html).toContain('УД-001');
    expect(html).toContain('Охрана труда');
    expect(html).toContain('Иванов Иван');
    expect(html).toContain('Скачать удостоверение');
    expect(html).not.toContain('ООО Ромашка');
    expect(html).not.toContain('href="/organization/students/s1"');
  });

  it('showOrganization → колонка «Организация»; studentHrefBase → ФИО ссылкой', () => {
    const html = renderToString(
      <CertificateRegistryTable
        rows={[row()]}
        showOrganization
        studentHrefBase="/organization/students"
      />
    );
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('href="/organization/students/s1"');
  });

  it('без documentId → «скан готовится»; validUntil null → «бессрочно»', () => {
    const html = renderToString(
      <CertificateRegistryTable rows={[row({ documentId: null, validUntil: null })]} />
    );
    expect(html).toContain('скан готовится');
    expect(html).not.toContain('Скачать удостоверение');
    expect(html).toContain('бессрочно');
  });
});

describe('CertificateRegistryFilters', () => {
  const directions = [{ id: 'd1', name: 'Охрана труда' }];

  it('рендерит селекты направления/статуса и поиск; организации нет без списка', () => {
    const html = renderToString(
      <CertificateRegistryFilters directions={directions} current={{}} />
    );
    expect(html).toContain('Все направления');
    for (const s of CERTIFICATE_STATUS_OPTIONS) {
      expect(html).toContain(s.label);
    }
    expect(html).toContain('Поиск по ФИО');
    expect(html).not.toContain('Все организации');
  });

  it('организации + текущие значения + hidden-параметры', () => {
    const html = renderToString(
      <CertificateRegistryFilters
        directions={directions}
        organizations={[{ id: 'org1', name: 'ООО Ромашка' }]}
        current={{ direction: 'd1', status: 'expiring', search: 'Иван', organization: 'org1' }}
        hidden={{ org: 'org-active' }}
      />
    );
    expect(html).toContain('Все организации');
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('name="org"');
    expect(html).toContain('value="org-active"');
    expect(html).toContain('Иван');
  });
});
