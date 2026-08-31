import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { notifyManagers } from '@/lib/notifications';
import { invoicePaymentState } from '@/lib/documents/invoicePayment';

/**
 * Этап 6 ТЗ (`У-148`, `У-159`) — «счёт закрыт платежами» доходит до менеджера.
 *
 * Признак оплаты вычисляется на лету и нигде не хранится: это правильно —
 * храни его, и он разъедется с платежами. Но у вычисляемого признака нет
 * момента «стало оплачено», а уведомление именно про момент. Поэтому
 * событием служит приход платежа: после записи платежей заказа мы
 * пересчитываем его счета и сообщаем о тех, что закрылись.
 *
 * **Повтор гасится по журналу уведомлений, а не по флагу на документе.**
 * Второй платёж по уже закрытому счёту (доплата, исправление в 1С) не должен
 * присылать менеджеру «счёт оплачен» ещё раз, а заводить ради этого колонку —
 * значит завести вторую версию правды рядом с платежами.
 */

/** Сколько счетов заказа закрылись этим приходом денег (и о скольких сообщили). */
export async function notifyInvoicesPaid(db: PrismaClient, orderId: string): Promise<number> {
  const invoices = await db.document.findMany({
    where: {
      orderId,
      type: 'invoice',
      status: { not: 'cancelled' },
      number: { not: null },
      amountGross: { not: null },
      // `У-151`: перевыпуск даёт двум версиям ОДИН номер и одну сумму. Без
      // этого фильтра обе стали бы «оплаченными», и менеджеру пришло бы два
      // уведомления об оплате одного счёта: защита от повтора ищет прежнее
      // уведомление по id документа, а id у версий разные.
      supersededAt: null,
    },
    select: { id: true, number: true, amountGross: true },
  });
  if (invoices.length === 0) return 0;

  const payments = await db.payment.findMany({
    where: { orderId },
    select: { amount: true, isRefund: true, purpose: true, note: true },
  });
  const mapped = payments.map((p) => ({
    amount: p.amount.toFixed(2),
    isRefund: p.isRefund,
    purpose: p.purpose,
    note: p.note,
  }));

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true },
  });
  if (!order) return 0;

  let notified = 0;
  for (const invoice of invoices) {
    const state = invoicePaymentState({
      number: invoice.number,
      // Decimal → строка: считаем в копейках, а не в плавающей точке.
      amountGross: invoice.amountGross!.toFixed(2),
      payments: mapped,
    });
    if (state?.state !== 'paid') continue;

    const already = await db.notification.findFirst({
      where: { type: 'invoice_paid', meta: { path: ['documentId'], equals: invoice.id } },
      select: { id: true },
    });
    if (already) continue;

    try {
      await notifyManagers(db, {
        orderId: order.id,
        type: 'invoice_paid',
        payload: {
          documentId: invoice.id,
          documentNumber: invoice.number,
          amount: invoice.amountGross!.toFixed(2),
          orderNumber: order.orderNumber,
        },
      });
      notified += 1;
    } catch (err) {
      // Уведомление — следствие, а не сам факт оплаты: сбой доставки не
      // должен ронять запись платежей из 1С.
      log.warn('[documents/invoicePaid] уведомление не ушло', {
        documentId: invoice.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return notified;
}
