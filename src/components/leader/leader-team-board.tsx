'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import type { TeamBoard, TeamBoardManager, TeamBoardOrg } from '@/lib/services/leader/teamBoard';
import {
  leaderAssignManagerAction,
  leaderDeactivateAssignmentAction,
  leaderTransferOrganizationAction,
} from '@/server-actions/manager/team';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { ListCapNotice } from '@/components/ui/list-cap-notice';
import { errorMessageRu } from '@/lib/errors/messages';
import { toast } from '@/lib/ui/toast';
import { fmtLastLogin, fmtMoney } from '@/lib/format';

/**
 * «Команда» руководителя по макету 2 (`У-346`, ТЗ 28.10.2026, `В-ТР-5`): у
 * каждого менеджера — его организации со статистикой; перевод организации
 * другому менеджеру и назначение ответственного организациям без менеджера.
 * Права и граница компании — в сервисах (`leaderTeam.ts`), здесь только вид.
 */
export function LeaderTeamBoard({ board }: { board: TeamBoard }) {
  // Новым ответственным может быть только действующий рядовой менеджер —
  // так же решает сервис; список в форме не обещает того, что сервис отклонит.
  const targets = board.managers.filter((m) => !m.isLeader && m.isActive);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#111111]">Организации менеджеров</h2>
        {board.managers.length === 0 ? (
          <EmptyState
            icon="👥"
            title="Менеджеров пока нет"
            message="Менеджеров заводит администратор. Как только он добавит менеджера в вашу компанию, здесь появятся его организации и результаты."
          />
        ) : (
          board.managers.map((m) => <ManagerCard key={m.id} manager={m} targets={targets} />)
        )}
      </section>
      <UnassignedSection board={board} targets={targets} />
    </div>
  );
}

function ManagerCard({
  manager,
  targets,
}: {
  manager: TeamBoardManager;
  targets: TeamBoardManager[];
}) {
  const activeOrders = manager.orgs.reduce((s, o) => s + o.activeOrders, 0);
  const overdue = manager.orgs.reduce((s, o) => s + o.overdue, 0);
  return (
    <details
      className="rounded-lg border bg-white"
      open={manager.orgs.length > 0}
      data-testid={`team-manager-${manager.id}`}
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3">
        <span>
          <span className="font-medium text-[#111111]">{manager.name}</span>
          {manager.isLeader && (
            <span className="ml-2 rounded bg-[#F97316] px-2 py-0.5 text-xs text-white">
              Руководитель
            </span>
          )}
          {!manager.isActive && (
            <span className="ml-2 rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
              Отключён
            </span>
          )}
          <span className="block text-xs text-gray-500">
            {manager.email} · последний вход: {fmtLastLogin(manager.lastLoginAt)}
          </span>
        </span>
        <span className="text-sm text-gray-600">
          Организаций: {manager.orgs.length} · заказов в работе: {activeOrders}
          {overdue > 0 && <span className="text-red-600"> · просрочено: {overdue}</span>}
        </span>
      </summary>
      {manager.orgs.length === 0 ? (
        <p className="border-t p-3 text-sm text-gray-500">
          Организаций нет — назначьте ему организацию ниже, в списке «Без ответственного».
        </p>
      ) : (
        <ul className="divide-y border-t">
          {manager.orgs.map((o) => (
            <OrgRow
              key={o.assignmentId}
              org={o}
              fromUserId={manager.id}
              targets={targets.filter((t) => t.id !== manager.id)}
            />
          ))}
        </ul>
      )}
    </details>
  );
}

function OrgRow({
  org,
  fromUserId,
  targets,
}: {
  org: TeamBoardOrg;
  fromUserId: string;
  targets: TeamBoardManager[];
}) {
  const [toUserId, setToUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const transfer = () =>
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set('organizationId', org.organizationId);
      fd.set('fromUserId', fromUserId);
      fd.set('toUserId', toUserId);
      const res = await leaderTransferOrganizationAction(fd);
      if (!res.ok) return setError(errorMessageRu(res.error));
      toast.success(
        res.ordersMoved > 0
          ? `Организация переведена, заказов в работе передано: ${res.ordersMoved}`
          : 'Организация переведена'
      );
    });

  const unassign = () =>
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set('assignmentId', org.assignmentId);
      const res = await leaderDeactivateAssignmentAction(fd);
      if (!res.ok) return setError(errorMessageRu(res.error));
      toast.success('Менеджер снят с организации');
    });

  return (
    <li className="grid gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <Link
          href={`/leader/organizations/${org.organizationId}`}
          className="font-medium text-[#111111] hover:text-[#EA580C]"
        >
          {org.name}
        </Link>
        <p className="text-xs text-gray-600">
          В работе: {org.activeOrders} на {fmtMoney(org.inWork)} · оплачено {fmtMoney(org.paid)}
          {org.overdue > 0 && <span className="text-red-600"> · просрочено: {org.overdue}</span>}
        </p>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`Кому перевести «${org.name}»`}
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          disabled={pending || targets.length === 0}
        >
          <option value="">
            {targets.length === 0 ? 'Некому перевести' : 'Перевести менеджеру…'}
          </option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={pending || !toUserId} onClick={transfer}>
          Перевести
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={unassign}>
          Снять
        </Button>
      </div>
    </li>
  );
}

function UnassignedSection({ board, targets }: { board: TeamBoard; targets: TeamBoardManager[] }) {
  const { rows, total } = board.unassigned;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-[#111111]">Без ответственного</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Организации, за которыми не закреплён ни один менеджер: их заказы никто не ведёт.
        </p>
      </div>
      {total === 0 ? (
        <EmptyState
          icon="✅"
          title="У всех организаций есть ответственный"
          message="Новые организации без менеджера появятся здесь — назначьте их сразу."
        />
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-white">
            {rows.map((r) => (
              <UnassignedRow key={r.id} org={r} targets={targets} />
            ))}
          </ul>
          <ListCapNotice
            shown={rows.length}
            total={total}
            hint="Назначьте этих — список подтянет следующие."
          />
        </>
      )}
    </section>
  );
}

function UnassignedRow({
  org,
  targets,
}: {
  org: { id: string; name: string; inn: string | null };
  targets: TeamBoardManager[];
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const assign = () =>
    startTransition(async () => {
      setError(null);
      const fd = new FormData();
      fd.set('mode', 'existing');
      fd.set('organizationId', org.id);
      fd.set('email', email);
      const res = await leaderAssignManagerAction(fd);
      if (!res.ok) return setError(errorMessageRu(res.error));
      toast.success('Ответственный назначен');
    });

  return (
    <li className="grid gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <Link
          href={`/leader/organizations/${org.id}`}
          className="font-medium text-[#111111] hover:text-[#EA580C]"
        >
          {org.name}
        </Link>
        {org.inn && <p className="text-xs text-gray-500">ИНН {org.inn}</p>}
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`Ответственный за «${org.name}»`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending || targets.length === 0}
        >
          <option value="">
            {targets.length === 0 ? 'Нет менеджеров' : 'Выберите менеджера…'}
          </option>
          {targets.map((t) => (
            <option key={t.id} value={t.email}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={pending || !email} onClick={assign}>
          Назначить
        </Button>
      </div>
    </li>
  );
}
