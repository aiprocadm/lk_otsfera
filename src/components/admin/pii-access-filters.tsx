import React from 'react';
import Link from 'next/link';

type Props = {
  /** Адрес экрана: используется ссылкой «Сбросить» (экран переехал в хаб настроек). */
  basePath: string;
  contexts: Array<{ key: string; labelRu: string }>;
  subjectTypes: string[];
  actors: Array<{ id: string; name: string; email: string }>;
  current: {
    actorUserId?: string | undefined;
    userRole?: string | undefined;
    context?: string | undefined;
    subjectType?: string | undefined;
    subjectId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  };
};

// `У-13`: на телефоне поле занимает всю ширину строки и может сжиматься —
// иначе `<select>` распирает страницу по самому длинному варианту списка
// («Все контексты», «Список слушателей», …), и экран становится 431px при 390px.
const inputCls = 'mt-1 w-full min-w-0 border border-gray-200 rounded px-2 py-1.5 text-sm';

export function PiiAccessFilters({ basePath, contexts, subjectTypes, actors, current }: Props) {
  const hasActive =
    current.actorUserId ||
    current.userRole ||
    current.context ||
    current.subjectType ||
    current.subjectId ||
    current.from ||
    current.to;

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-xl p-3"
    >
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        Сотрудник
        <select name="actorUserId" defaultValue={current.actorUserId ?? ''} className={inputCls}>
          <option value="">Все сотрудники</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{`${a.name} (${a.email})`}</option>
          ))}
        </select>
      </label>
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        Роль
        <select name="userRole" defaultValue={current.userRole ?? ''} className={inputCls}>
          <option value="">Все роли</option>
          <option value="admin">admin</option>
          <option value="manager">manager</option>
          <option value="leader">leader</option>
        </select>
      </label>
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        Контекст
        <select name="context" defaultValue={current.context ?? ''} className={inputCls}>
          <option value="">Все контексты</option>
          {contexts.map((c) => (
            <option key={c.key} value={c.key}>
              {c.labelRu}
            </option>
          ))}
        </select>
      </label>
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        Тип субъекта
        <select name="subjectType" defaultValue={current.subjectType ?? ''} className={inputCls}>
          <option value="">Все типы</option>
          {subjectTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        ID субъекта
        <input
          type="text"
          name="subjectId"
          defaultValue={current.subjectId ?? ''}
          placeholder="точный id"
          className={inputCls}
        />
      </label>
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        С
        <input type="date" name="from" defaultValue={current.from ?? ''} className={inputCls} />
      </label>
      <label className="flex w-full flex-col text-xs text-gray-500 sm:w-auto">
        По
        <input type="date" name="to" defaultValue={current.to ?? ''} className={inputCls} />
      </label>
      {/* Инлайн-hex скопирован 1:1 из sibling audit-log-filters.tsx — консистентность с соседом. */}
      <button
        type="submit"
        className="px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C]"
      >
        Применить
      </button>
      {hasActive && (
        <Link
          href={basePath}
          className="px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-600 hover:bg-gray-50"
        >
          Сбросить
        </Link>
      )}
    </form>
  );
}
