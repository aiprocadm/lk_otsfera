/**
 * «Это тот же заказ, что …» — действия объединения заказа из Битрикс24 с
 * заказом 1С (этап 2 ТЗ 12.09.2026, `У-197`, `В-2-4`).
 *
 * Действие тонкое (§3): разбирает вход, зовёт сервис и обновляет экраны. Права
 * проверяет сервис — здесь он замокан, поэтому проверяется именно связка:
 * форма входа, гард сессии, дословный проброс результата и перечитывание обоих
 * адресов во всех трёх кабинетах сотрудников. Перечитывание после отказа —
 * отдельный регресс: заказ никуда не делся, дёргать кэш незачем.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, mergeExternalOrderInto, listMergeTargets, revalidatePath } = vi.hoisted(
  () => ({
    requireSession: vi.fn(),
    mergeExternalOrderInto: vi.fn(),
    listMergeTargets: vi.fn(),
    revalidatePath: vi.fn(),
  })
);

vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/services/orders/mergeExternal', () => ({
  mergeExternalOrderInto,
  listMergeTargets,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { __marker: 'prisma' } }));
vi.mock('next/cache', () => ({ revalidatePath }));

import {
  mergeExternalOrderAction,
  listMergeTargetsAction,
} from '@/server-actions/orders/mergeExternal';

const SESSION = { sub: 'u-1', role: 'admin' as const, companyId: 'c1' };
const OK = { ok: true as const, moved: { documents: 2, tasks: 1, notes: 3, deal: true } };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  mergeExternalOrderInto.mockResolvedValue(OK);
  listMergeTargets.mockResolvedValue({ ok: true, targets: [] });
});

describe('mergeExternalOrderAction', () => {
  it('счастливый путь: сервис зовётся с сессией и парой заказов, результат возвращается дословно', async () => {
    const res = await mergeExternalOrderAction({
      sourceOrderId: 'src-1',
      targetOrderId: 'dst-1',
    });

    expect(res).toEqual(OK);
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(mergeExternalOrderInto).toHaveBeenCalledWith({ __marker: 'prisma' }, SESSION, {
      sourceOrderId: 'src-1',
      targetOrderId: 'dst-1',
    });
  });

  it('успех перечитывает оба заказа и список во всех трёх кабинетах сотрудников', async () => {
    await mergeExternalOrderAction({ sourceOrderId: 'src-1', targetOrderId: 'dst-1' });

    // Исходный заказ удалён, целевой пополнился: без перечитывания человек
    // увидел бы удалённый заказ живым.
    expect(revalidatePath.mock.calls.map(([p]) => p)).toEqual([
      '/admin/orders/src-1',
      '/admin/orders/dst-1',
      '/admin/orders',
      '/leader/orders/src-1',
      '/leader/orders/dst-1',
      '/leader/orders',
      '/manager/orders/src-1',
      '/manager/orders/dst-1',
      '/manager/orders',
    ]);
  });

  it.each([
    ['forbidden'],
    ['not_found'],
    ['not_bitrix_order'],
    ['same_order'],
    ['other_organization'],
    ['target_is_bitrix'],
    ['has_payments'],
    ['has_lines'],
    ['has_activity'],
    ['target_has_deal'],
  ])('отказ сервиса %s пробрасывается как есть и ничего не перечитывает', async (error) => {
    mergeExternalOrderInto.mockResolvedValue({ ok: false, error });

    const res = await mergeExternalOrderAction({
      sourceOrderId: 'src-1',
      targetOrderId: 'dst-1',
    });

    expect(res).toEqual({ ok: false, error });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['пустой исходный заказ', { sourceOrderId: '', targetOrderId: 'dst-1' }],
    ['пустой целевой заказ', { sourceOrderId: 'src-1', targetOrderId: '' }],
    ['идентификатор длиннее 64 символов', { sourceOrderId: 'x'.repeat(65), targetOrderId: 'd' }],
    ['не строка вместо заказа', { sourceOrderId: 7 as unknown as string, targetOrderId: 'd' }],
    ['поля вовсе нет', {} as unknown as { sourceOrderId: string; targetOrderId: string }],
  ])('%s → validation: ни сессии, ни сервиса, ни перечитывания', async (_name, input) => {
    const res = await mergeExternalOrderAction(input);

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(requireSession).not.toHaveBeenCalled();
    expect(mergeExternalOrderInto).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('гард сессии срабатывает до сервиса: редирект гостя наружу, объединение не начинается', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(
      mergeExternalOrderAction({ sourceOrderId: 'src-1', targetOrderId: 'dst-1' })
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mergeExternalOrderInto).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('listMergeTargetsAction', () => {
  it('кандидаты отдаются как есть, сервис получает сессию и исходный заказ', async () => {
    const targets = [
      { id: 'o-1', label: '№ 2024-001 — Обучение', totalAmount: '1000.00', closedAt: null },
    ];
    listMergeTargets.mockResolvedValue({ ok: true, targets });

    const res = await listMergeTargetsAction('src-1');

    expect(res).toEqual({ ok: true, targets });
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(listMergeTargets).toHaveBeenCalledWith({ __marker: 'prisma' }, SESSION, 'src-1');
  });

  it('пустой идентификатор → validation, до сессии и сервиса дело не доходит', async () => {
    const res = await listMergeTargetsAction('');

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(requireSession).not.toHaveBeenCalled();
    expect(listMergeTargets).not.toHaveBeenCalled();
  });

  it('отказ сервиса пробрасывается кодом (кнопка переведёт его на русский)', async () => {
    listMergeTargets.mockResolvedValue({ ok: false, error: 'not_bitrix_order' });

    expect(await listMergeTargetsAction('src-1')).toEqual({
      ok: false,
      error: 'not_bitrix_order',
    });
  });

  it('гард сессии срабатывает до сервиса', async () => {
    requireSession.mockRejectedValue(new Error('NEXT_REDIRECT'));

    await expect(listMergeTargetsAction('src-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(listMergeTargets).not.toHaveBeenCalled();
  });
});
