import type { PrismaClient } from '@prisma/client';

/**
 * `У-174`: сколько документов 1С не приняла и ждут человека.
 *
 * Считаются только `failed` и только действующие версии: заменённая
 * перевыпуском версия в 1С уже не поедет, её ошибка — история, а не задача.
 * Одна функция на светофор и на оповещение — иначе цифры разъедутся.
 */
export async function countFailedDocumentPushes(
  prisma: PrismaClient,
  scope: { companyId?: string | undefined } = {}
): Promise<number> {
  return prisma.document.count({
    where: {
      oneCPushStatus: 'failed',
      supersededAt: null,
      ...(scope.companyId ? { companyId: scope.companyId } : {}),
    },
  });
}
