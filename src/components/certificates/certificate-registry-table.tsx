import React from 'react';
import Link from 'next/link';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { CertificateDownloadButton } from '@/components/enrollment/certificate-download-button';
import { fmtDate } from '@/lib/format';
import { CertificateStatusBadge } from './certificate-status-badge';

/**
 * Таблица клиентского реестра удостоверений (этап 3, ФТ-6.1/6.2). Shared для
 * organization/partner: у партнёра — колонка «Организация», у организации —
 * ФИО ссылкой на карточку сотрудника. Скачивание — только через generic
 * download-роут (кнопка этапа 2); без скана — «скан готовится».
 */

export type CertificateRegistryRow = {
  id: string;
  number: string;
  issuedAt: Date;
  validUntil: Date | null;
  documentId: string | null;
  student: { id: string; name: string };
  direction: { name: string };
  organization: { id: string; name: string };
};

export function CertificateRegistryTable({
  rows,
  showOrganization = false,
  studentHrefBase = null,
  // `У-175`: на карточке сотрудника фильтров нет — совет «изменить фильтры»
  // там сбивает с толку; карточка передаёт свой текст (как у партнёра).
  emptyMessage = 'Удостоверений не найдено — попробуйте изменить фильтры.',
}: {
  rows: CertificateRegistryRow[];
  showOrganization?: boolean;
  /** База ссылки на карточку сотрудника ('/organization/students') или null — без ссылок. */
  studentHrefBase?: string | null;
  emptyMessage?: string;
}) {
  const today = new Date();

  if (rows.length === 0) {
    return <EmptyState icon="📜" message={emptyMessage} />;
  }

  return (
    <TableShell>
      <THead>
        <Th>Сотрудник</Th>
        {showOrganization && <Th>Организация</Th>}
        <Th>Направление</Th>
        <Th>Номер</Th>
        <Th>Выдано</Th>
        <Th>Действует до</Th>
        <Th>Статус</Th>
        <Th>Скан</Th>
      </THead>
      <tbody>
        {rows.map((c) => (
          <Tr key={c.id}>
            <Td className="font-medium text-[#111111]">
              {studentHrefBase ? (
                <Link
                  href={`${studentHrefBase}/${c.student.id}`}
                  className="hover:text-[#F97316] hover:underline"
                >
                  {c.student.name}
                </Link>
              ) : (
                c.student.name
              )}
            </Td>
            {showOrganization && <Td className="text-gray-600">{c.organization.name}</Td>}
            <Td>{c.direction.name}</Td>
            <Td className="font-mono text-xs text-gray-700">{c.number}</Td>
            <Td className="text-gray-500">{fmtDate(c.issuedAt)}</Td>
            <Td className="text-gray-500">{c.validUntil ? fmtDate(c.validUntil) : 'бессрочно'}</Td>
            <Td>
              <CertificateStatusBadge validUntil={c.validUntil} today={today} />
            </Td>
            <Td>
              {c.documentId ? (
                <CertificateDownloadButton documentId={c.documentId} />
              ) : (
                <span className="text-xs text-gray-400">скан готовится</span>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
