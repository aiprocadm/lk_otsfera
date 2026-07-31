/**
 * §11 ТЗ v0.5 — сборка данных экрана настройки полей.
 *
 * Общая для двух страниц (`/admin/custom-fields` и зеркала руководителя
 * `/leader/settings/custom-fields`): обе показывают одно и то же, различается
 * только гард и `basePath` ссылок. Логика живёт здесь, чтобы страницы остались
 * тонкими (§2 CLAUDE.md — направление зависимостей).
 */

import type { CustomFieldDefinition, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listDefinitions } from './definitions';
import { isCustomFieldEntity, type CustomFieldEntity } from './entities';
import { systemFieldsFor, type SystemFieldDescriptor } from './systemFields';

export const DEFAULT_ENTITY: CustomFieldEntity = 'order';

/**
 * Разбирает `?entity=` из адреса. Неизвестное значение — НЕ 404: адрес правят
 * руками и по ссылкам, показать заявку полезнее, чем стену ошибки.
 */
export function parseEntityParam(raw: string | string[] | undefined): CustomFieldEntity {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'string' && isCustomFieldEntity(value)) return value;
  return DEFAULT_ENTITY;
}

export type CustomFieldsScreenData = {
  entity: CustomFieldEntity;
  definitions: CustomFieldDefinition[];
  systemFields: SystemFieldDescriptor[];
};

/**
 * Данные экрана. Гейт (admin ∨ leader) уже отработал в `listDefinitions`;
 * отказ отдаём пустым списком — страницу открывает только тот, кого пустил
 * серверный гард самой страницы.
 */
export async function getCustomFieldsScreen(
  prisma: PrismaClient,
  session: SessionPayload,
  rawEntity: string | string[] | undefined
): Promise<CustomFieldsScreenData> {
  const entity = parseEntityParam(rawEntity);
  const res = await listDefinitions(prisma, session, entity);

  return {
    entity,
    definitions: res.ok ? res.rows : [],
    systemFields: systemFieldsFor(entity),
  };
}
