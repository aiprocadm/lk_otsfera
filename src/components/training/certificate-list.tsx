'use client';

import React from 'react';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { CertificateBadge } from '@/components/training/certificate-badge';
import { fmtDate } from '@/lib/format';

export type CertificateListItem = {
  id: string;
  number: string;
  direction: { name: string };
  issuedAt: string | Date;
  validUntil: string | Date | null;
};

export function CertificateList({ certificates }: { certificates: CertificateListItem[] }) {
  const today = new Date();

  if (certificates.length === 0) {
    return <EmptyState icon="📄" message="Нет удостоверений." className="p-8" />;
  }

  return (
    <TableShell>
      <THead>
        <Th>Номер</Th>
        <Th>Направление</Th>
        <Th>Выдано</Th>
        <Th>Срок действия</Th>
      </THead>
      <tbody>
        {certificates.map((cert) => {
          const validUntil =
            cert.validUntil == null
              ? null
              : cert.validUntil instanceof Date
                ? cert.validUntil
                : new Date(cert.validUntil);
          return (
            <Tr key={cert.id}>
              <Td className="font-mono text-xs text-gray-700">{cert.number}</Td>
              <Td>{cert.direction.name}</Td>
              <Td className="text-gray-500">{fmtDate(cert.issuedAt)}</Td>
              <Td>
                <CertificateBadge validUntil={validUntil} today={today} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
