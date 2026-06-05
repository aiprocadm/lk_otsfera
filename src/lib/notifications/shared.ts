export function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export function orderLabel(orderNumber: string | null, orderTitle: string): string {
  return orderNumber ? `№ ${orderNumber}` : `«${orderTitle}»`;
}
