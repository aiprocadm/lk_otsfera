import React from 'react';
import Link from 'next/link';
import type { LeadStatus, ClientRequestStatus, EnrollmentStatus } from '@prisma/client';
import { Badge, EmptyState, ExportLink, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { CallsList } from '@/components/manager/calls-list';
import { LeadStatusBadge } from '@/components/partner/lead-status-badge';
import { clientRequestStatusLabel } from '@/lib/services/clientRequests/labels';
import { enrollmentStatusLabel } from '@/lib/services/enrollments/labels';
import { auditActionLabel } from '@/lib/audit/labels';
import { orgCardTiles } from '@/lib/navigation/orgCardTiles';
import type { OrgCardTabKey } from '@/lib/navigation/orgCardTabs';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

/**
 * G4 — презентация CRM-карточки организации. Табы через query-param (?tab=) —
 * серверный рендер, без клиентского JS. manager-специфичный компонент (лидер
 * переиспользует manager-деталь; своей [id]-страницы у лидера нет). НЕ делать
 * cross-role общим (§4 sibling-rule).
 */

// `У-95`: состав, названия, значки и порядок вкладок — в реестре
// `lib/navigation/orgCardTabs.ts`, один на все кабинеты. Здесь остаётся только
// отрисовка. Тип реэкспортируем: компонент — публичная точка для страниц.
export type { OrgCardTabKey as OrgCardTab } from '@/lib/navigation/orgCardTabs';

const money = (v: string) => `${v} ₽`;
const dateRu = (d: Date) => new Date(d).toLocaleDateString('ru-RU');

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[#F3F4F6] px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-[#111111]">{value}</p>
    </div>
  );
}

export function OrgCardTabs({
  card,
  activeTab,
  tabs,
  employees,
  settings,
  egrulAction,
}: {
  card: OrganizationCard;
  activeTab: OrgCardTabKey;
  /** Вкладки кабинета — результат `orgCardTabsFor` (фильтр реестра по роли и флагам). */
  tabs: ReadonlyArray<{ key: OrgCardTabKey; label: string }>;
  /**
   * `У-97`: готовая секция сотрудников. Данные грузит страница своей роли —
   * компонент остаётся презентационным и не ходит в базу.
   */
  employees?: React.ReactNode;
  /**
   * `У-99`: готовая вкладка «Настройки» (реквизиты, доступ в кабинет,
   * менеджеры, ставка, доп. поля). Собирается страницей своей роли — состав и
   * права у кабинетов разные, а названия и порядок общие (реестр
   * `orgSettingsSections`).
   */
  settings?: React.ReactNode;
  /**
   * `У-94`: кнопка «Найти в ЕГРЮЛ». Приходит от страницы своей роли — право на
   * подстановку решает сервис, а не карточка. Без неё плашка «ИНН не указан»
   * всё равно показывается: факт от прав не зависит.
   */
  egrulAction?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">{card.name}</h1>
        {/* §15 «что здесь делают»: одна строка простыми словами. Без неё
            карточка отвечала только на «где я» — заголовком с названием. */}
        <p className="text-sm text-gray-500 mt-1">
          Всё об организации в одном месте: сотрудники, заказы, документы и настройки.
        </p>
        {card.partner && <p className="text-sm text-gray-500 mt-1">Партнёр: {card.partner.name}</p>}
      </div>

      {/* `У-94`: организации из выписки приходят без ИНН — человек должен
          видеть это сразу и иметь кнопку, а не выяснять по пустой строке в
          реквизитах. */}
      {card.inn === null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-[#111111]">
            <strong>ИНН не указан.</strong> Без него не собрать счёт и акт, а импорт из 1С не свяжет
            организацию по ИНН.
          </p>
          {egrulAction}
        </div>
      )}

      {/* `У-102`: подписи и источники чисел — из реестра плиток, одни на все
          кабинеты. «Активные» и «Оплачено» остаются рядом как справочные KPI
          менеджера, но общие четыре плитки идут первыми и в общем порядке. */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {orgCardTiles({
          orders: card.counts.orders,
          students: card.counts.students,
          cabinetUsers: card.counts.cabinetUsers,
          debt: card.kpis.debt,
        }).map((tile) => (
          <Tile key={tile.key} label={tile.label} value={tile.value} />
        ))}
        <Tile label="Активные" value={card.kpis.activeOrders} />
        <Tile label="Оплачено" value={money(card.kpis.totalPaid)} />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            data-testid={`org-tab-${t.key}`}
            data-active={t.key === activeTab}
            className={`px-3 py-2 text-sm rounded-t-md -mb-px border-b-2 ${
              t.key === activeTab
                ? 'border-[#F97316] text-[#EA580C] font-semibold'
                : 'border-transparent text-gray-500 hover:text-[#111111]'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section>
        {activeTab === 'employees'
          ? employees
          : activeTab === 'settings'
            ? settings
            : renderSection(card, activeTab)}
      </section>
    </div>
  );
}

function renderSection(card: OrganizationCard, tab: OrgCardTabKey): React.ReactNode {
  switch (tab) {
    case 'orders':
      return <OrdersSection orders={card.orders} />;
    case 'documents':
      return <DocumentsSection documents={card.documents} />;
    case 'payments':
      return <PaymentsSection payments={card.payments} kpis={card.kpis} orgId={card.id} />;
    case 'certificates':
      return <CertificatesSection certificates={card.certificates} orgId={card.id} />;
    case 'comments':
      return <CommentsSection activity={card.activity} />;
    case 'inbound':
      return <InboundMessagesSection inboundMessages={card.inboundMessages} />;
    case 'calls':
      return <CallsList items={card.calls} />;
    case 'requests':
      return <ClientRequestsSection requests={card.clientRequests} />;
    case 'leads':
      return <LeadsSection leads={card.leads} />;
    case 'deals':
      return <DealsSection deals={card.deals} />;
    case 'enrollments':
      return <EnrollmentsSection enrollments={card.enrollments} />;
    case 'history':
      return <AuditTrailSection entries={card.auditTrail} />;
    case 'overview':
    default:
      return <OverviewSection card={card} />;
  }
}

/**
 * `У-96`: «Заявки на обучение» — список слушателей, которых надо обучить.
 * Раньше их не было видно рядом с историей клиента.
 */
function EnrollmentsSection({ enrollments }: { enrollments: OrganizationCard['enrollments'] }) {
  if (enrollments.length === 0) return <EmptyState message="Заявок на обучение пока нет." />;
  return (
    <TableShell>
      <THead>
        <Th>Обучение</Th>
        <Th>Слушателей</Th>
        <Th>Статус</Th>
        <Th>Подана</Th>
      </THead>
      <tbody>
        {enrollments.map((e) => (
          <Tr key={e.id}>
            <Td className="font-medium">{e.courseTitle ?? 'Без названия'}</Td>
            <Td>{e.studentsCount}</Td>
            <Td>
              <Badge tone="neutral">
                {enrollmentStatusLabel(e.status as EnrollmentStatus)}
              </Badge>
            </Td>
            <Td>{dateRu(e.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/**
 * `У-96`: «История» — журнал действий по организации. Названия действий берутся
 * из общего словаря: в базе они машинные, человеку показываем по-русски.
 */
function AuditTrailSection({ entries }: { entries: OrganizationCard['auditTrail'] }) {
  if (entries.length === 0) {
    return <EmptyState message="Изменений по этой организации ещё не было." />;
  }
  return (
    <TableShell>
      <THead>
        <Th>Что сделали</Th>
        <Th>Кто</Th>
        <Th>Когда</Th>
      </THead>
      <tbody>
        {entries.map((e) => (
          <Tr key={e.id}>
            <Td className="font-medium">{auditActionLabel(e.action)}</Td>
            <Td className="text-gray-700">{e.actorName ?? '—'}</Td>
            <Td className="whitespace-nowrap text-gray-500">{dateRu(e.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function OrdersSection({ orders }: { orders: OrganizationCard['orders'] }) {
  if (orders.length === 0) return <EmptyState message="Заявок пока нет." />;
  return (
    <TableShell>
      <THead>
        <Th>№</Th>
        <Th>Название</Th>
        <Th>Исполнение</Th>
        <Th>Финансы</Th>
        <Th>Сумма</Th>
        <Th>Оплачено</Th>
      </THead>
      <tbody>
        {orders.map((o) => (
          <Tr key={o.id}>
            <Td>{o.orderNumber ?? '—'}</Td>
            <Td className="font-medium">{o.title}</Td>
            <Td>
              <Badge tone="neutral">{o.executionStatus}</Badge>
            </Td>
            <Td>
              <Badge tone="neutral">{o.financialStatus}</Badge>
            </Td>
            <Td>{money(o.totalAmount)}</Td>
            <Td>{money(o.paidAmount)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function DocumentsSection({ documents }: { documents: OrganizationCard['documents'] }) {
  if (documents.length === 0) return <EmptyState message="Документов пока нет." />;
  return (
    <TableShell>
      <THead>
        <Th>Название</Th>
        <Th>Тип</Th>
        <Th>Направление</Th>
        <Th>Дата</Th>
      </THead>
      <tbody>
        {documents.map((d) => (
          <Tr key={d.id}>
            <Td className="font-medium">{d.name}</Td>
            <Td>{d.type}</Td>
            <Td>{d.direction}</Td>
            <Td>{dateRu(d.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function PaymentsSection({
  payments,
  kpis,
  orgId,
}: {
  payments: OrganizationCard['payments'];
  kpis: OrganizationCard['kpis'];
  orgId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="grid grid-cols-2 gap-3 max-w-md flex-1">
          <Tile label="Оплачено (нетто)" value={money(kpis.totalPaid)} />
          <Tile label="Возвраты" value={money(kpis.totalRefunded)} />
        </div>
        {/* ФТ-12.2: платежи/задолженность клиента в Excel (staff-путь). */}
        <ExportLink base={`/api/manager/organizations/${orgId}/payments/export`} />
      </div>
      {payments.length === 0 ? (
        <EmptyState message="Оплат пока нет." />
      ) : (
        <TableShell>
          <THead>
            <Th>Дата</Th>
            <Th>Сумма</Th>
            <Th>Тип</Th>
          </THead>
          <tbody>
            {payments.map((p) => (
              <Tr key={p.id}>
                <Td>{dateRu(p.paidAt)}</Td>
                <Td>{money(p.amount)}</Td>
                <Td>
                  {p.isRefund ? (
                    <Badge tone="danger">Возврат</Badge>
                  ) : (
                    <Badge tone="success">Оплата</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}

/** Этап 9 (ФТ-12.2): реестр удостоверений организации в карточке + выгрузка. */
function CertificatesSection({
  certificates,
  orgId,
}: {
  certificates: OrganizationCard['certificates'];
  orgId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <p className="text-sm text-gray-500">
          {certificates.length === 0
            ? 'Удостоверений пока нет.'
            : `Последние ${certificates.length} — полный реестр в выгрузке.`}
        </p>
        <ExportLink base={`/api/manager/organizations/${orgId}/certificates/export`} />
      </div>
      {certificates.length === 0 ? (
        <EmptyState message="Удостоверений пока нет." />
      ) : (
        <TableShell>
          <THead>
            <Th>Номер</Th>
            <Th>Сотрудник</Th>
            <Th>Направление</Th>
            <Th>Выдано</Th>
            <Th>Действует до</Th>
            <Th>Скан</Th>
          </THead>
          <tbody>
            {certificates.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.number}</Td>
                <Td>{c.studentName}</Td>
                <Td>{c.directionName}</Td>
                <Td>{dateRu(c.issuedAt)}</Td>
                <Td>{c.validUntil ? dateRu(c.validUntil) : 'бессрочно'}</Td>
                <Td>
                  {c.hasScan ? (
                    <Badge tone="success">есть</Badge>
                  ) : (
                    <Badge tone="neutral">готовится</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}

function CommentsSection({ activity }: { activity: OrganizationCard['activity'] }) {
  if (activity.length === 0)
    return <EmptyState message="Комментариев по заказам пока нет." />;
  return (
    <ul className="space-y-2">
      {activity.map((c) => (
        <li key={c.id} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{c.authorName}</span>
            <span>{dateRu(c.createdAt)}</span>
          </div>
          <p className="text-sm text-[#111111] mt-1">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

const INBOUND_CHANNEL_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
  email: 'Email',
  cabinet: 'Вопрос из кабинета',
};

const INBOUND_STATUS_TONE: Record<string, 'warning' | 'success' | 'neutral'> = {
  unresolved: 'warning',
  bound: 'success',
  archived: 'neutral',
};

const INBOUND_STATUS_LABEL: Record<string, string> = {
  unresolved: 'Не распознано',
  bound: 'Привязано',
  archived: 'В архиве',
};

function inboundExcerpt(body: string, max = 140): string {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Read-only история обращений (Task 12/G4) — привязка/ответ живут только в /manager/inbox. */
function InboundMessagesSection({
  inboundMessages,
}: {
  inboundMessages: OrganizationCard['inboundMessages'];
}) {
  if (inboundMessages.length === 0) return <EmptyState message="Обращений нет" />;
  return (
    <TableShell>
      <THead>
        <Th>Канал</Th>
        <Th>Отправитель</Th>
        <Th>Сообщение</Th>
        <Th>Статус</Th>
        <Th>Дата</Th>
      </THead>
      <tbody>
        {inboundMessages.map((m) => (
          <Tr key={m.id}>
            <Td>
              <Badge tone="neutral">{INBOUND_CHANNEL_LABEL[m.channel] ?? m.channel}</Badge>
            </Td>
            <Td className="text-gray-700">{m.senderDisplay || m.senderRef}</Td>
            <Td className="max-w-md text-gray-600">
              {m.subject && <p className="font-medium text-[#111111]">{m.subject}</p>}
              <p>{inboundExcerpt(m.body)}</p>
              {m.attachmentName && (
                <p className="mt-1 text-xs text-gray-500">📎 {m.attachmentName}</p>
              )}
            </Td>
            <Td>
              <Badge tone={INBOUND_STATUS_TONE[m.status] ?? 'neutral'}>
                {INBOUND_STATUS_LABEL[m.status] ?? m.status}
              </Badge>
            </Td>
            <Td className="whitespace-nowrap text-gray-500">{dateRu(m.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/**
 * `У-96`: «Обзор» — сводка по клиенту: что заказывали, что оплатили, о чём
 * говорили. Раньше эта сводка называлась «Историей», из-за чего настоящего
 * журнала действий в карточке не было.
 */
function OverviewSection({ card }: { card: OrganizationCard }) {
  const hasAny = card.orders.length + card.payments.length + card.activity.length > 0;
  if (!hasAny) {
    return <EmptyState message="Работа с этим клиентом ещё не начиналась." />;
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <MiniPanel title="Последние заявки">
        {card.orders.slice(0, 5).map((o) => (
          <MiniRow key={o.id} left={o.title} right={dateRu(o.createdAt)} />
        ))}
      </MiniPanel>
      <MiniPanel title="Последние оплаты">
        {card.payments.slice(0, 5).map((p) => (
          <MiniRow
            key={p.id}
            left={`${p.isRefund ? '− ' : ''}${money(p.amount)}`}
            right={dateRu(p.paidAt)}
          />
        ))}
      </MiniPanel>
      <MiniPanel title="Последние комментарии">
        {card.activity.slice(0, 5).map((c) => (
          <MiniRow key={c.id} left={c.body.slice(0, 40)} right={dateRu(c.createdAt)} />
        ))}
      </MiniPanel>
    </div>
  );
}

function MiniPanel({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <h3 className="text-sm font-semibold text-[#111111] mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">—</p>
      ) : (
        <div className="space-y-1">{items}</div>
      )}
    </div>
  );
}

function MiniRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-[#111111] truncate">{left}</span>
      <span className="text-gray-400 shrink-0">{right}</span>
    </div>
  );
}

// Этап 7 (PR-3): вкладки внутреннего контура. Клиентские роли карточку
// не видят вовсе (страница /manager/*) — раздел 3.2 ТЗ не нарушается.
function ClientRequestsSection({ requests }: { requests: OrganizationCard['clientRequests'] }) {
  if (requests.length === 0) return <EmptyState message="Заявок клиентов пока нет." />;
  return (
    <TableShell>
      <THead>
        <Th>Тема</Th>
        <Th>Статус</Th>
        <Th>Подана</Th>
      </THead>
      <tbody>
        {requests.map((r) => (
          <Tr key={r.id}>
            <Td className="font-medium">{r.subject}</Td>
            <Td>
              <Badge tone="neutral">
                {clientRequestStatusLabel(r.status as ClientRequestStatus)}
              </Badge>
              {r.rejectedReason && (
                <span className="ml-2 text-xs text-gray-500">{r.rejectedReason}</span>
              )}
            </Td>
            <Td>{dateRu(r.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function LeadsSection({ leads }: { leads: OrganizationCard['leads'] }) {
  if (leads.length === 0) return <EmptyState message="Лидов пока нет." />;
  return (
    <TableShell>
      <THead>
        <Th>Тема</Th>
        <Th>Статус</Th>
        <Th>Создан</Th>
      </THead>
      <tbody>
        {leads.map((l) => (
          <Tr key={l.id}>
            <Td className="font-medium">
              <Link href={`/manager/leads/${l.id}`} className="text-[#EA580C] hover:underline">
                {l.subject}
              </Link>
            </Td>
            <Td>
              <LeadStatusBadge status={l.status as LeadStatus} />
            </Td>
            <Td>{dateRu(l.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

const DEAL_STATUS_LABEL: Record<string, string> = {
  open: 'В работе',
  won: 'Выиграна',
  lost: 'Проиграна',
};
const DEAL_STATUS_TONE: Record<string, 'neutral' | 'success' | 'danger'> = {
  open: 'neutral',
  won: 'success',
  lost: 'danger',
};

function DealsSection({ deals }: { deals: OrganizationCard['deals'] }) {
  if (deals.length === 0) return <EmptyState message="Сделок пока нет." />;
  return (
    <TableShell>
      <THead>
        <Th>Название</Th>
        <Th>Статус</Th>
        <Th>Сумма</Th>
        <Th>Создана</Th>
      </THead>
      <tbody>
        {deals.map((d) => (
          <Tr key={d.id}>
            <Td className="font-medium">{d.title}</Td>
            <Td>
              <Badge tone={DEAL_STATUS_TONE[d.status] ?? 'neutral'}>
                {DEAL_STATUS_LABEL[d.status] ?? d.status}
              </Badge>
            </Td>
            <Td>{d.amount ? money(d.amount) : '—'}</Td>
            <Td>{dateRu(d.createdAt)}</Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}
