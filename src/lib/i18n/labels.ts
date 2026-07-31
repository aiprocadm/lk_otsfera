/**
 * Словари «код 1С → русская подпись». Коды — свободные строки из 1С,
 * поэтому всегда fallback на исходный код (не падать на новом значении).
 */
const ORDER_TYPE_RU: Record<string, string> = {
  supply: 'Поставка',
  service: 'Услуги',
  training: 'Обучение',
};

export function orderTypeRu(code: string): string {
  return ORDER_TYPE_RU[code] ?? code;
}

const PAYMENT_METHOD_RU: Record<string, string> = {
  wire: 'Банковский перевод',
  card: 'Карта',
  cash: 'Наличные',
};

export function paymentMethodRu(code: string | null | undefined): string {
  if (!code) return '—';
  return PAYMENT_METHOD_RU[code] ?? code;
}
