import React from 'react';
import Link from 'next/link';

export function StatCard({
  title,
  value,
  accent,
  href,
  hint,
  hintLink,
}: {
  title: string;
  value: number | string;
  accent?: boolean | undefined;
  href?: string | undefined;
  /**
   * `У-345`: строка под числом — что именно оно считает («к выплате ·
   * выплачено в этом месяце …»). Без неё плитка — число без смысла.
   */
  hint?: string | undefined;
  /**
   * `У-345`: оранжевая подпись-приглашение со стрелкой («Отдельно по
   * организациям ›») — видно, что плитка кликабельна и куда ведёт.
   */
  hintLink?: string | undefined;
}) {
  const card = (
    <div
      className={`rounded-xl border p-5 flex flex-col gap-2 shadow-sm transition-shadow hover:shadow-md ${accent ? 'bg-[#F97316] border-[#EA580C] text-white' : 'bg-white border-gray-200'}`}
    >
      <div
        className={`text-xs font-medium uppercase tracking-wider ${accent ? 'text-orange-100' : 'text-gray-500'}`}
      >
        {title}
      </div>
      <div className={`text-3xl font-bold ${accent ? 'text-white' : 'text-[#111111]'}`}>
        {value}
      </div>
      {hint && (
        <div className={`text-xs ${accent ? 'text-orange-100' : 'text-gray-500'}`}>{hint}</div>
      )}
      {hintLink && (
        <div className={`text-xs font-medium ${accent ? 'text-white' : 'text-[#EA580C]'}`}>
          {`${hintLink} ›`}
        </div>
      )}
    </div>
  );
  if (!href) return card;
  return (
    <Link
      href={href}
      className="block focus-visible:outline-2 focus-visible:outline-[#F97316] rounded-xl"
    >
      {card}
    </Link>
  );
}
