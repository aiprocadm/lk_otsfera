import type { CreateOrgByManagerError } from '@/lib/services/manager/organizationCreate';

/**
 * Что видит человек, когда «Создать организацию» не удалось (`У-308`, `У-309`).
 * Одна таблица на оба места — окно в «Организациях» и форму контакта.
 */
const ORG_CREATE_ERROR_RU: Record<CreateOrgByManagerError, string> = {
  forbidden: 'Создавать организации может сотрудник своей компании.',
  validation: 'Проверьте название и ИНН: ИНН — 10 или 12 цифр.',
  org_exists: 'Такая организация уже есть.',
  org_in_other_company:
    'Организация с этим ИНН ведётся другой компанией — обратитесь к администратору.',
};

export function orgCreateErrorRu(error: CreateOrgByManagerError): string {
  return ORG_CREATE_ERROR_RU[error];
}
