import type { PartnerMaterialCategory } from '@prisma/client';

/**
 * Категории материалов для партнёров (`У-237`) — справочник, который читают и
 * клиентские компоненты (форма, экран хаба, список партнёра), и сервер.
 * Отдельный модуль без `node:`-импортов: остальное из `shared.ts` серверное,
 * и клиентский бандл его тянуть не должен (страж `components.client-server-boundary`).
 */
export const PARTNER_MATERIAL_CATEGORIES: PartnerMaterialCategory[] = [
  'price_list',
  'presentation',
  'template',
  'instruction',
  'other',
];

export const PARTNER_MATERIAL_CATEGORY_LABELS: Record<PartnerMaterialCategory, string> = {
  price_list: 'Прайс-листы',
  presentation: 'Презентации',
  template: 'Шаблоны',
  instruction: 'Инструкции',
  other: 'Прочее',
};

export function parseMaterialCategory(
  raw: string | undefined
): PartnerMaterialCategory | undefined {
  return PARTNER_MATERIAL_CATEGORIES.find((c) => c === raw);
}
