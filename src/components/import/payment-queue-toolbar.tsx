import React from 'react';

/**
 * Панель очереди ручного разбора (`У-90`): счётчик «всего», диапазон открытых
 * строк, фильтры и сортировка. Раньше список молча обрезался на 200 строках —
 * человек видел кусок и не знал, что есть ещё (CLAUDE.md §16, «краевой путь»).
 *
 * Фильтры — ссылки, а не форма: адрес остаётся тем, чем можно поделиться и
 * куда возвращает «назад». Любая смена фильтра сбрасывает страницу на первую.
 */
type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Ссылка с новым значением параметра; повторное нажатие снимает фильтр. */
function toggleHref(
  basePath: string,
  searchParams: SearchParams,
  key: string,
  value: string
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    // skip/take не переносим: смена фильтра или сортировки возвращает на
    // первую страницу, иначе человек попадает на «страницу 5 из 1».
    if (k === key || k === 'skip' || k === 'take') continue;
    const one = first(v);
    if (one) params.set(k, one);
  }
  if (first(searchParams[key]) !== value) params.set(key, value);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      // Ссылка, а не кнопка: фильтр живёт в адресе. Для ссылки состояние
      // «выбрана» выражается `aria-current` (`aria-pressed` роль link не
      // поддерживает — ловит eslint jsx-a11y).
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-[#EA580C] bg-orange-50 text-[#EA580C]'
          : 'border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      {children}
    </a>
  );
}

export function PaymentQueueToolbar({
  basePath,
  searchParams,
  total,
  take,
  skip,
}: {
  basePath: string;
  searchParams: SearchParams;
  total: number;
  take: number;
  skip: number;
}) {
  const from = total === 0 ? 0 : Math.min(skip + 1, total);
  const to = Math.min(skip + take, total);
  const inn = first(searchParams.inn);
  const candidate = first(searchParams.candidate);
  const sort = first(searchParams.sort);
  const chip = (key: string, value: string, label: string) => (
    <Chip
      href={toggleHref(basePath, searchParams, key, value)}
      active={first(searchParams[key]) === value}
    >
      {label}
    </Chip>
  );

  return (
    <div className="mb-3 space-y-2">
      <p className="text-sm text-gray-500" data-testid="queue-total">
        {`Всего в очереди: ${total}${total > 0 ? ` · показаны ${from}–${to}` : ''}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Показать:</span>
        {chip('inn', 'without', 'без ИНН')}
        {chip('inn', 'with', 'с ИНН')}
        {chip('candidate', 'org', 'есть кандидат-организация')}
        {chip('candidate', 'order', 'есть кандидат-заказ')}
        <span className="ml-2 text-xs text-gray-500">Сортировка:</span>
        {chip('sort', 'date', 'по дате')}
        {chip('sort', 'amount', 'по сумме')}
        {chip('sort', 'counterparty', 'по контрагенту')}
      </div>
      {(inn || candidate || sort) && (
        <a href={basePath} className="inline-block text-xs text-[#EA580C] hover:underline">
          Сбросить фильтры
        </a>
      )}
    </div>
  );
}
