import Link from 'next/link';
import type { ManagerStudentRow } from '@/lib/services/manager/students';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { fmtDate } from '@/lib/format';

/**
 * Presentational table of manager-scoped students. Mirrors the visual tone of
 * `manager-orgs-list` (white card, gray header, orange hover). Unlike the
 * organization-cabinet sibling, this view spans multiple orgs, so each row
 * shows the organization name as a clickable link to /manager/organizations/[id].
 */
export function ManagerStudentsTable({ rows }: { rows: ManagerStudentRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon='👥' message='Сотрудники не найдены.' />;
  }

  return (
    <TableShell>
      <THead>
        <Th>ФИО</Th>
        <Th>Email</Th>
        <Th>Организация</Th>
        <Th>ID сотрудника</Th>
        <Th>Добавлен</Th>
      </THead>
      <tbody>
        {rows.map((s) => (
          <Tr key={s.id}>
            <Td className='font-medium text-[#111111]'>{s.name}</Td>
            <Td className='text-gray-600'>{s.email}</Td>
            <Td>
              <Link
                href={`/manager/organizations/${s.organization.id}`}
                className='text-[#F97316] hover:underline'
              >
                {s.organization.name}
              </Link>
            </Td>
            <Td className='text-gray-500 font-mono text-xs'>
              {s.externalStudentId ?? '—'}
            </Td>
            <Td className='text-gray-500'>
              {fmtDate(s.createdAt)}
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
