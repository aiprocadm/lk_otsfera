/**
 * §11 ТЗ v0.5 — реестр системных полей: их «удалить нельзя».
 *
 * Решение заказчика Q2 (29.07.2026): системные поля НЕ заводятся записями в
 * `CustomFieldDefinition`. Перечисленные в §11 поля (название организации,
 * ответственный менеджер, ФИО сотрудника и т.д.) — это реальные колонки Prisma;
 * зеркало в справочнике дало бы два источника правды для одного значения.
 *
 * Реестр даёт две вещи:
 *   1) экран настройки показывает системные поля серым блоком с бейджем
 *      «системное», без кнопок изменения и деактивации (PR-2);
 *   2) ключи зарезервированы — нельзя создать второе поле «Статус» (reserved_key).
 */

import type { CustomFieldEntity } from './entities';

export type SystemFieldDescriptor = {
  /** Машинный ключ — он же зарезервирован для настраиваемых полей. */
  key: string;
  /** Русская подпись, как её видит заказчик. */
  label: string;
  /** Откуда берётся значение — подсказка на экране настройки. */
  source: string;
};

/**
 * Состав по §11 ТЗ. Для сущностей, у которых ТЗ системных полей не перечисляет
 * (заявка, партнёр, документ), список пуст — но ключ в объекте есть, чтобы
 * добавление сущности не требовало правки типов.
 */
export const SYSTEM_FIELDS: Record<CustomFieldEntity, SystemFieldDescriptor[]> = {
  organization: [
    { key: 'name', label: 'Название', source: 'Карточка организации' },
    { key: 'org_type', label: 'Тип (прямая / партнёрская)', source: 'Наличие связанного партнёра' },
    { key: 'partner', label: 'Связанный партнёр', source: 'Карточка организации' },
    { key: 'assigned_manager', label: 'Ответственный менеджер', source: 'Назначение менеджера' },
    { key: 'status', label: 'Статус', source: 'Карточка организации' }
  ],
  student: [
    { key: 'name', label: 'ФИО', source: 'Карточка сотрудника' },
    { key: 'organization', label: 'Организация', source: 'Привязка сотрудника' },
    { key: 'status', label: 'Статус карточки', source: 'Карточка сотрудника' }
  ],
  order: [],
  partner: [],
  document: []
};

/** Занят ли ключ системным полем этой сущности. */
export function isReservedKey(entityType: CustomFieldEntity, key: string): boolean {
  return SYSTEM_FIELDS[entityType].some((f) => f.key === key);
}

/** Системные поля сущности (пустой массив, если их нет). */
export function systemFieldsFor(entityType: CustomFieldEntity): SystemFieldDescriptor[] {
  return SYSTEM_FIELDS[entityType];
}
