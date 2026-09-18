import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className, ...rest }, children),
}));

import { DocumentVersionHistory } from '@/components/documents/document-version-history';
import { DocumentDownloads } from '@/components/documents/document-downloads';
import type { VersionRow } from '@/lib/services/documents/versions';
import type { DownloadRow } from '@/lib/services/documents/history';

/**
 * Два блока карточки документа у сотрудников: «История версий» (`У-251`) и
 * «Кто скачивал» (`У-254`).
 *
 * Проверяется то, что человек читает глазами: какая версия действующая, кто её
 * загрузил, кто и что унёс. Пустой журнал обязан сказать, что он пуст, а не
 * показывать заголовок над пустотой.
 */
const version = (over: Partial<VersionRow> = {}): VersionRow => ({
  id: 'd2',
  version: 2,
  name: 'schet-v2.pdf',
  createdAt: new Date('2026-09-10T09:00:00Z'),
  uploadedByName: 'Иванов',
  supersededAt: null,
  ...over,
});

const download = (over: Partial<DownloadRow> = {}): DownloadRow => ({
  id: 'a1',
  at: new Date('2026-09-15T07:30:00Z'),
  userName: 'Петров',
  roleLabel: 'Менеджер',
  version: 2,
  ...over,
});

describe('DocumentVersionHistory (У-251)', () => {
  it('одна версия — блока нет вовсе', () => {
    const html = renderToString(
      <DocumentVersionHistory versions={[version()]} currentId="d2" hrefBase="/manager/documents" />
    );
    expect(html).toBe('');
  });

  it('две версии: сверху последняя, у неё пометка «действующая»', () => {
    const html = renderToString(
      <DocumentVersionHistory
        versions={[
          version({
            id: 'd1',
            version: 1,
            name: 'schet-v1.pdf',
            supersededAt: new Date('2026-09-10T09:00:00Z'),
          }),
          version(),
        ]}
        currentId="d2"
        hrefBase="/manager/documents"
      />
    );
    expect(html).toContain('История версий');
    expect(html).toContain('Версия 2');
    expect(html).toContain('действующая');
    expect(html).toContain('заменена');
    expect(html).toContain('Иванов');
    // Последняя версия идёт раньше первой: с ней и работают.
    expect(html.indexOf('Версия 2')).toBeLessThan(html.indexOf('Версия 1'));
  });

  it('на открытую версию ссылки нет, на остальные — есть', () => {
    const html = renderToString(
      <DocumentVersionHistory
        versions={[version({ id: 'd1', version: 1, name: 'schet-v1.pdf' }), version()]}
        currentId="d2"
        hrefBase="/leader/documents"
      />
    );
    expect(html).toContain('href="/leader/documents/d1"');
    expect(html).not.toContain('href="/leader/documents/d2"');
  });

  it('загрузчик неизвестен — прочерк вместо пустоты', () => {
    const html = renderToString(
      <DocumentVersionHistory
        versions={[version({ id: 'd1', version: 1, uploadedByName: null }), version()]}
        currentId="d2"
        hrefBase="/manager/documents"
      />
    );
    expect(html).toContain('—');
  });
});

describe('DocumentDownloads (У-254)', () => {
  it('показывает когда, кто, в какой роли и какую версию унесли', () => {
    const html = renderToString(<DocumentDownloads downloads={[download()]} auditHref={null} />);
    expect(html).toContain('Кто скачивал');
    expect(html).toContain('Петров');
    expect(html).toContain('Менеджер');
    expect(html).toContain('версия 2');
    expect(html).toContain('Показаны последние 20 скачиваний.');
  });

  it('пустой журнал говорит, что он пуст', () => {
    const html = renderToString(<DocumentDownloads downloads={[]} auditHref={null} />);
    expect(html).toContain('Документ ещё никто не скачивал.');
  });

  it('версия старой записи не выдумывается', () => {
    const html = renderToString(
      <DocumentDownloads
        downloads={[download({ version: null, userName: null })]}
        auditHref={null}
      />
    );
    expect(html).toContain('версия неизвестна');
    expect(html).toContain('—');
  });

  it('ссылка на журнал появляется только там, где журнал есть', () => {
    const withLink = renderToString(
      <DocumentDownloads downloads={[download()]} auditHref="/admin/settings/security/audit" />
    );
    expect(withLink).toContain('href="/admin/settings/security/audit"');
    expect(withLink).toContain('Весь журнал действий');

    const withoutLink = renderToString(
      <DocumentDownloads downloads={[download()]} auditHref={null} />
    );
    expect(withoutLink).not.toContain('Весь журнал действий');
  });
});
