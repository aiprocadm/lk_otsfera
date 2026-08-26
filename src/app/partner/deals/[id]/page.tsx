import { permanentRedirect } from 'next/navigation';

/**
 * Старый адрес карточки заказа партнёра (`У-109`). Закладка на конкретный заказ
 * обязана довести до него же, а не до списка.
 */
export default async function PartnerDealDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/partner/orders/${id}`);
}
