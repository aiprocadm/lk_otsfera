/**
 * §11 ТЗ v0.5 — сущности, у которых бывают настраиваемые поля.
 *
 * Колонка `CustomFieldDefinition.entityType` остаётся строкой (менять на enum —
 * дорогая миграция без выгоды), поэтому закрытый список живёт здесь и
 * валидируется в сервисе определений.
 */

export const CUSTOM_FIELD_ENTITIES = [
  'order',
  'organization',
  'partner',
  'student',
  'document',
] as const;

export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Русские подписи сущностей — для экрана настройки (PR-2). */
export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  order: 'Заявка',
  organization: 'Организация',
  partner: 'Партнёр',
  student: 'Сотрудник организации',
  document: 'Документ',
};

export function isCustomFieldEntity(value: string): value is CustomFieldEntity {
  return (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}
