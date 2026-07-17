import React from 'react';

/**
 * Пресетные цвета свотчей стадий/колонок. Это пользовательские ДАННЫЕ (значение
 * поля `color`, хранится в БД), а не брендовая палитра UI: инлайновый
 * `style={{ background: hex }}` ниже — data-driven рендер значения, поэтому
 * правило CLAUDE.md §13 («не инлайнь brand-hex — переиспользуй примитив»)
 * не нарушается.
 */
export const COLOR_SWATCH_PRESETS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899'
] as const;

/** Человекочитаемые имена пресетов для aria-label (рескью-свотч остаётся с hex). */
const PRESET_LABEL: Record<string, string> = {
  '#EF4444': 'Красный',
  '#F97316': 'Оранжевый',
  '#EAB308': 'Жёлтый',
  '#22C55E': 'Зелёный',
  '#06B6D4': 'Голубой',
  '#3B82F6': 'Синий',
  '#8B5CF6': 'Фиолетовый',
  '#EC4899': 'Розовый'
};

/** Тот же строгий формат, что и в zod-схемах сервисов (funnelStages / tasks/columns). */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type ColorSwatchPickerProps = {
  /** Имя radio-группы: под этим ключом значение уходит в FormData формы. */
  name: string;
  /** Текущий цвет (`#RRGGBB`) или null — «без цвета». */
  value: string | null;
};

const SWATCH =
  'block h-6 w-6 rounded-full peer-checked:ring-2 peer-checked:ring-offset-1 peer-checked:ring-gray-500 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-gray-700';

/**
 * Презентационный uncontrolled radio-group выбора цвета для FormData-форм:
 * пресеты + «Без цвета» (value '' — экшены маппят пустую строку в null через
 * `str(fd,'color') || null`). Выбранный кружок подсвечивается кольцом чисто
 * через CSS (`peer-checked`), состояние не требуется — диалоги сабмитят форму
 * целиком. Не-пресетное сохранённое значение рендерится дополнительным
 * свотчем, чтобы существующий цвет не затирался молча при пересохранении, —
 * но только если оно проходит строгий #RRGGBB (иначе legacy-мусор упал бы
 * validation при сабмите на ужесточённой zod-схеме); невалидное значение
 * трактуем как null → checked получает «Без цвета».
 */
export function ColorSwatchPicker({ name, value }: ColorSwatchPickerProps) {
  const current = value && HEX_RE.test(value) ? value : '';
  const isPreset = COLOR_SWATCH_PRESETS.some((p) => p.toLowerCase() === current.toLowerCase());
  const swatches: string[] = [...COLOR_SWATCH_PRESETS, ...(current !== '' && !isPreset ? [current] : [])];

  return (
    <fieldset role="radiogroup" aria-label="Цвет" className="m-0 border-0 p-0">
      <legend className="text-xs text-gray-500 mb-1 p-0">Цвет</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer" title="Без цвета">
          <input
            type="radio"
            name={name}
            value=""
            defaultChecked={current === ''}
            aria-label="Без цвета"
            className="peer sr-only"
          />
          <span aria-hidden className={`relative border border-gray-300 bg-gray-100 ${SWATCH}`}>
            <span className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-gray-400" />
          </span>
        </label>
        {swatches.map((hex) => (
          <label key={hex} className="cursor-pointer" title={hex}>
            <input
              type="radio"
              name={name}
              value={hex}
              defaultChecked={hex.toLowerCase() === current.toLowerCase()}
              aria-label={PRESET_LABEL[hex] ?? `Цвет ${hex}`}
              className="peer sr-only"
            />
            {/* data-driven цвет значения, не brand-hex палитры — см. комментарий у пресетов */}
            <span aria-hidden className={SWATCH} style={{ background: hex }} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
