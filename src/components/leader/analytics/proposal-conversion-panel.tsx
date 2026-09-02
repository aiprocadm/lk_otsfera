import React from 'react';
import type { ProposalConversion } from '@/lib/services/leader/analytics';

/**
 * `У-166` (этап 7) — конверсия коммерческих предложений за месяц.
 *
 * Отдельный блок со СВОИМ заголовком, а не ещё одна плитка рядом с воронкой
 * лидов: там уже есть слово «Конверсия», и две одинаковые подписи на одном
 * экране означали бы разное — руководитель сравнивал бы несравнимое.
 *
 * Подпись под числом объясняет, что именно посчитано: это когорта, и цифра за
 * текущий месяц всегда занижена — по вчерашним предложениям клиент ещё думает.
 * Без этой строки руководитель сделал бы вывод о падении продаж из свойства
 * календаря.
 */
export function ProposalConversionPanel({ conversion }: { conversion: ProposalConversion }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-[#111111] mb-1">Коммерческие предложения</h2>
      <p className="text-xs text-gray-500 mb-3">
        Отправлено за месяц и сколько из них клиенты приняли. По свежим предложениям ответа может
        ещё не быть — они в графе «ждут ответа».
      </p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Отправлено" value={String(conversion.sent)} />
        <Tile
          label="Приняли"
          value={
            // Прочерк, а не «0 %»: «не предлагали» и «предлагали, но никто не
            // купил» — разные вещи, и ноль сказал бы второе.
            conversion.conversionPct === null
              ? '—'
              : `${conversion.accepted} · ${conversion.conversionPct}%`
          }
          accent
        />
        <Tile label="Ждут ответа" value={String(conversion.pending)} />
        <Tile label="Отклонили" value={String(conversion.rejected)} />
        <Tile label="Истёк срок" value={String(conversion.expired)} />
        <Tile label="Аннулировано" value={String(conversion.cancelled)} />
      </div>
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-semibold ${accent ? 'text-[#EA580C]' : 'text-[#111111]'}`}>
        {value}
      </div>
    </div>
  );
}
