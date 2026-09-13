import { normalizeLabel } from '@/lib/services/import/normalize';
import type { BitrixStage, BitrixTaskStatus } from '../source';
import { stageKey } from './types';

/**
 * Сопоставление стадий и статусов портала со стадиями ЛК (`У-193`).
 *
 * Предложение строится само: семантика `success` → стадия-якорь «выиграна»,
 * `failure`/`apology` → «проиграна», остальные — по совпадению названия. Всё,
 * что не сопоставилось, остаётся `null`: пакет нельзя применить, пока человек
 * не выберет стадию — иначе сделки молча свалились бы в одну кучу.
 *
 * `default:*` — синтетические идентификаторы дефолтных стадий (их нет в базе).
 * В строку сущности такой идентификатор писать нельзя: `persistStageId`
 * превращает его в `null`, а смысл несёт якорь статуса.
 */
export type TargetStage = {
  id: string;
  name: string;
  statusAnchor: string;
  isTerminal: boolean;
};

export function persistStageId(id: string | null): string | null {
  return !id || id.startsWith('default:') ? null : id;
}

function byName(stages: readonly TargetStage[], name: string): TargetStage | undefined {
  const key = normalizeLabel(name);
  return key ? stages.find((s) => normalizeLabel(s.name) === key) : undefined;
}

function byAnchor(stages: readonly TargetStage[], anchor: string): TargetStage | undefined {
  return stages.find((s) => s.statusAnchor === anchor);
}

/**
 * Предложение таблицы «стадия сделки портала → стадия ЛК». Ключ — `направление:стадия`
 * (у общего направления «0»), значение — идентификатор стадии ЛК или `null`.
 */
export function proposeStageMap(
  portalStages: readonly BitrixStage[],
  dealStages: readonly TargetStage[],
  saved: Record<string, string | null> = {}
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const known = new Set(dealStages.map((s) => s.id));
  for (const stage of portalStages) {
    if (stage.entity !== 'deal') continue;
    const key = stageKey(stage);
    // Решение человека сильнее догадки — но только если стадия ещё существует.
    const savedId = saved[key];
    if (savedId && known.has(savedId)) {
      out[key] = savedId;
      continue;
    }
    const anchor =
      stage.semantics === 'success' ? 'won' : stage.semantics === 'failure' ? 'lost' : null;
    const guess =
      (anchor ? byAnchor(dealStages, anchor) : undefined) ?? byName(dealStages, stage.name);
    out[key] = guess?.id ?? null;
  }
  return out;
}

/**
 * Предложение таблицы «статус лида портала → стадия воронки ЛК». `CONVERTED`
 * и `JUNK` имеют прямые соответствия в жизненном цикле лида, остальное —
 * по названию.
 */
export function proposeLeadStageMap(
  portalStages: readonly BitrixStage[],
  funnelStages: readonly TargetStage[],
  saved: Record<string, string | null> = {}
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const known = new Set(funnelStages.map((s) => s.id));
  for (const stage of portalStages) {
    if (stage.entity !== 'lead') continue;
    const savedId = saved[stage.id];
    if (savedId && known.has(savedId)) {
      out[stage.id] = savedId;
      continue;
    }
    const anchor =
      stage.semantics === 'success'
        ? 'promoted_to_deal'
        : stage.semantics === 'failure'
          ? 'rejected'
          : null;
    const guess =
      (anchor ? byAnchor(funnelStages, anchor) : undefined) ?? byName(funnelStages, stage.name);
    out[stage.id] = guess?.id ?? null;
  }
  return out;
}

/** Статусы задач Битрикса и их умолчания в колонках ЛК (спека §3.3). */
export const BITRIX_TASK_STATUSES: readonly BitrixTaskStatus[] = [2, 3, 4, 5, 6];

export const BITRIX_TASK_STATUS_LABELS: Record<BitrixTaskStatus, string> = {
  2: 'Ждёт выполнения',
  3: 'Выполняется',
  4: 'Ждёт контроля',
  5: 'Завершена',
  6: 'Отложена',
};

/** Куда по умолчанию кладём задачу: якорь колонки ЛК для каждого статуса портала. */
const TASK_STATUS_ANCHORS: Record<BitrixTaskStatus, string> = {
  2: 'todo',
  3: 'in_progress',
  4: 'review',
  5: 'done',
  6: 'todo',
};

export function proposeTaskColumnMap(
  columns: readonly TargetStage[],
  saved: Record<string, string | null> = {}
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const known = new Set(columns.map((c) => c.id));
  for (const status of BITRIX_TASK_STATUSES) {
    const savedId = saved[String(status)];
    if (savedId && known.has(savedId)) {
      out[String(status)] = savedId;
      continue;
    }
    const anchor = TASK_STATUS_ANCHORS[status];
    out[String(status)] = byAnchor(columns, anchor)?.id ?? columns[0]?.id ?? null;
  }
  return out;
}

/** Стадии портала, для которых человек ещё не выбрал стадию ЛК. */
export function unmappedStages(
  portalStages: readonly BitrixStage[],
  stageMap: Record<string, string | null>,
  leadStageMap: Record<string, string | null>
): string[] {
  const out: string[] = [];
  for (const stage of portalStages) {
    const mapped = stage.entity === 'deal' ? stageMap[stageKey(stage)] : leadStageMap[stage.id];
    if (!mapped) out.push(`${stage.entity === 'deal' ? 'Сделки' : 'Лиды'}: ${stage.name}`);
  }
  return out;
}

/** Пакет можно применять, только когда сопоставлены ВСЕ стадии портала (`У-193`). */
export function stageMapComplete(
  portalStages: readonly BitrixStage[],
  stageMap: Record<string, string | null>,
  leadStageMap: Record<string, string | null>
): boolean {
  return unmappedStages(portalStages, stageMap, leadStageMap).length === 0;
}
