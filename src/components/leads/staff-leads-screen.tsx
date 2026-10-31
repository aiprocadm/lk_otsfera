import React from 'react';
import Link from 'next/link';
import type {
  StaffLeadsPageData,
  StaffLeadsSearchParams,
} from '@/lib/services/leads/staffLeadsPage';
import { ManagerLeadsFilter } from '@/components/manager/manager-leads-filter';
import { ManagerLeadsTable } from '@/components/manager/manager-leads-table';
import { LeadCreateStaffForm } from '@/components/manager/lead-create-staff-form';
import { FunnelBoard } from '@/components/funnel/funnel-board';
import { PageHeader } from '@/components/ui/page-header';
import { ListCapNotice } from '@/components/ui';
import { SALES_STAGE_LINE } from '@/lib/help/salesStages';
import type { OrgCardHrefBase } from '@/components/party/inn-duplicate-hint';

/**
 * Экран «Лиды» — один на кабинеты менеджера и руководителя (этап 4 ТЗ
 * 28.10.2026, `У-349`, правило зеркала §0.2). Воронка — вид внутри «Лидов»
 * (`У-312`, `В-ПМ-3` (а)), а не отдельный раздел: у менеджера так с 13.10, у
 * руководителя — с этого этапа.
 *
 * Различие кабинетов — только адреса (`basePath`, `orgCardHrefBase`) и блок под
 * воронкой (`funnelExtra`): стадии воронки настраивает руководитель.
 */

export type StaffLeadsScreenProps = {
  /** Адрес раздела: `/manager/leads` или `/leader/leads`. */
  basePath: string;
  /** Карточки организаций своего кабинета (подсказка о дубле ИНН в форме). */
  orgCardHrefBase: OrgCardHrefBase;
  data: StaffLeadsPageData;
  sp: StaffLeadsSearchParams;
  /** Что показать под доской в виде «Воронка» (у руководителя — настройка стадий). */
  funnelExtra?: React.ReactNode;
};

const TAB_ON = 'border-[#F97316] bg-[#F97316] text-white';
const TAB_OFF = 'border-gray-200 bg-white text-[#111111]';

export function StaffLeadsScreen({
  basePath,
  orgCardHrefBase,
  data,
  sp,
  funnelExtra,
}: StaffLeadsScreenProps) {
  const { board, list, funnelEnabled, organizations } = data;
  const query = { status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe };

  return (
    <>
      {/* `У-13`: заголовок, подзаголовок и кнопка не помещаются в одну строку
          телефона (424px против 390px) — на узком экране они идут столбиком. */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <PageHeader
            title="Лиды"
            // `У-288`: нейтрально; `У-311`: чем лид отличается от сделки и заказа.
            subtitle={SALES_STAGE_LINE.leads}
          />
        </div>
        <LeadCreateStaffForm organizations={organizations} orgCardHrefBase={orgCardHrefBase} />
      </div>
      {funnelEnabled && (
        <nav aria-label="Вид лидов" className="mb-3 flex gap-1">
          <Link
            href={basePath}
            aria-current={board ? undefined : 'page'}
            className={`rounded-lg border px-3 py-1.5 text-sm ${board ? TAB_OFF : TAB_ON}`}
          >
            Список
          </Link>
          <Link
            href={`${basePath}?view=funnel`}
            aria-current={board ? 'page' : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${board ? TAB_ON : TAB_OFF}`}
          >
            Воронка
          </Link>
        </nav>
      )}
      {board ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Перетаскивайте карточки между стадиями. «Передано в работу» создаёт заказ, «Отказ»
            требует причину.
          </p>
          <FunnelBoard board={board} />
          <ListCapNotice
            shown={board.shown}
            total={board.total}
            hint="Живые лиды идут первыми и не теряются; за пределом — самые старые обработанные, их видно в карточке организации (вкладка «Лиды»)."
          />
          {funnelExtra}
        </div>
      ) : (
        <>
          <ManagerLeadsFilter basePath={basePath} query={query} />
          <ManagerLeadsTable
            basePath={basePath}
            rows={list?.rows ?? []}
            nextCursor={list?.nextCursor ?? null}
            query={query}
          />
        </>
      )}
    </>
  );
}
