import React from 'react';
import { EmptyState } from '@/components/ui';
import type { OrgCardCabinet } from '@/lib/navigation/orgCardTabs';
import {
  orgSettingsSectionsFor,
  type OrgSettingsSectionKey,
} from '@/lib/navigation/orgSettingsSections';

/**
 * Вкладка «Настройки» карточки организации (`У-99`) — общая рамка на все
 * кабинеты.
 *
 * Компонент строго презентационный (`Р-23`): названия, пояснения и порядок
 * секций он берёт из реестра [orgSettingsSections.ts], а **содержимое** каждой
 * секции приходит готовым узлом от страницы своей роли. Так данные и права
 * остаются в сервисе роли (§4 defense-in-depth), а человек в любом кабинете
 * видит один и тот же набор с одними и теми же названиями в одном порядке
 * (§0.2, правило зеркала).
 *
 * Секция без содержимого не рисуется: пустая секция — дефект приёмки (`У-74`).
 */
export type OrgSettingsSlots = Partial<Record<OrgSettingsSectionKey, React.ReactNode>>;

export function OrgSettingsTab({
  cabinet,
  slots,
}: {
  cabinet: OrgCardCabinet;
  slots: OrgSettingsSlots;
}) {
  const sections = orgSettingsSectionsFor(cabinet).filter(
    (s) => slots[s.key] !== undefined && slots[s.key] !== null
  );

  if (sections.length === 0) {
    // Пустой экран объясняет себя (`У-74`): человек не должен гадать, почему
    // «Настройки» пусты — прав на настройки этой организации просто нет.
    return <EmptyState message="Настройки этой организации вам недоступны." />;
  }

  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <section
          key={s.key}
          data-testid={`org-settings-${s.key}`}
          className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3"
        >
          <div>
            <h2 className="text-base font-semibold text-[#111111]">{s.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
          </div>
          {slots[s.key]}
        </section>
      ))}
    </div>
  );
}
