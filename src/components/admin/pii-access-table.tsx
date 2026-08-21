import React from 'react';
import type { PiiAccessRow } from '@/lib/services/admin/piiAccess';
import { TableShell, THead, Th, Tr, Td, EmptyState } from '@/components/ui';
import { CardList, Card, CardRow } from '@/components/ui/card-list';

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

const SUBJECTS_PREVIEW = 5;

export function PiiAccessTable({ rows }: { rows: PiiAccessRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="Записей журнала не найдено" className="p-8" />;
  }
  const subjectsPreview = (row: PiiAccessRow) =>
    row.subjects
      .slice(0, SUBJECTS_PREVIEW)
      .map((s) => s.label)
      .join(', ');

  return (
    <>
      {/* `У-18`: колонок пять — на телефоне таблица уступает место карточкам,
          иначе страница шире экрана (431px против 390px). */}
      <CardList>
        {rows.map((row) => (
          <Card key={row.id} title={row.actor ? row.actor.name : 'Сотрудник не указан'}>
            <CardRow label="Когда">{dateFormatter.format(row.createdAt)}</CardRow>
            <CardRow label="Почта">{row.actor?.email}</CardRow>
            <CardRow label="Роль">{row.userRole}</CardRow>
            <CardRow label="Контекст">{row.labelRu}</CardRow>
            <CardRow label="Субъекты">
              {subjectsPreview(row)}
              {row.subjectCount > SUBJECTS_PREVIEW
                ? ` и ещё ${row.subjectCount - SUBJECTS_PREVIEW}`
                : ''}
            </CardRow>
            <CardRow label="Всего субъектов">{row.subjectCount}</CardRow>
          </Card>
        ))}
      </CardList>

      <TableShell className="hidden md:block">
        <THead>
          <Th>Когда</Th>
          <Th>Сотрудник</Th>
          <Th>Роль</Th>
          <Th>Контекст</Th>
          <Th>Субъекты</Th>
        </THead>
        <tbody>
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td className="text-gray-500 text-xs">{dateFormatter.format(row.createdAt)}</Td>
              <Td>
                {row.actor ? (
                  <>
                    <div>{row.actor.name}</div>
                    <div className="text-xs text-gray-400">{row.actor.email}</div>
                  </>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </Td>
              <Td className="font-mono text-xs">{row.userRole}</Td>
              <Td>
                <div>{row.labelRu}</div>
                <div className="text-xs text-gray-400 font-mono">{row.context}</div>
              </Td>
              <Td>
                <div className="text-xs text-gray-600">
                  {row.subjects
                    .slice(0, SUBJECTS_PREVIEW)
                    .map((s) => s.label)
                    .join(', ')}
                  {row.subjectCount > SUBJECTS_PREVIEW && (
                    <span className="text-gray-400">{` и ещё ${row.subjectCount - SUBJECTS_PREVIEW}`}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400">всего: {row.subjectCount}</div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
