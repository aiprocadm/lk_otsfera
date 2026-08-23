import type { PrismaClient } from '@prisma/client';
import { normalizeInn, isValidInn } from '@/lib/services/oneCSync/inn';
import { counterpartyKey } from './counterparty-key';
import { enrichInnByName, type EnrichResult } from './dadata-inn';

/**
 * Контрагенты из выписки, которых в системе ещё нет (`У-52`, `У-86`).
 *
 * До этапа 1 кандидатом становился только контрагент с валидным ИНН, а в
 * карточке счёта 51 у большинства строк ИНН нет вовсе — отсюда жалоба
 * «создалось три организации из десятков». Теперь единица группировки —
 * **ключ названия** (`У-83`), а ИНН лишь атрибут кандидата: из файла, из
 * ЕГРЮЛ (`У-85`) или вписанный человеком в предпросмотре (`У-87`).
 *
 * Считаем только по строкам, ушедшим в очередь разбора: строка, привязавшаяся
 * к заказу или организации, по определению уже нашла своего клиента —
 * заводить ему дубль было бы вредом, а не пользой.
 */
export type InnSource = 'file' | 'dadata' | 'manual';

export type NewCounterparty = {
  /** Ключ названия (`У-83`) — единица группировки и дедупликации. */
  key: string;
  name: string;
  inn: string | null;
  innSource: InnSource | null;
  /** Название из ЕГРЮЛ рядом с названием из файла (`У-87`). */
  egrulName?: string;
  /** Сколько строк файла принадлежит этому контрагенту. */
  rows: number;
};

/** Контрагент, для которого организация уже есть: платежи просто привяжутся. */
export type ExistingCounterparty = {
  key: string;
  organizationId: string;
  reason: 'inn' | 'name';
};

/** Правка предпросмотра (`У-87`): снять создание либо вписать ИНН руками. */
export type CounterpartyOverride = { key: string; create?: boolean; inn?: string };

export type CollectResult = {
  candidates: NewCounterparty[];
  existing: ExistingCounterparty[];
  /** Почему контрагент не попал в создание — для диагностики `У-92`. */
  reasons: Record<string, number>;
  /** Ключи, для которых человек вписал негодный ИНН (отказ до записи). */
  badOverrides: string[];
  dadata: EnrichResult;
  /** Сколько контрагентов всего увидели в файле (`У-92`). */
  total: number;
};

type QueuedRow = { counterpartyName: string | null; counterpartyInn: string | null };

type Options = {
  /** Компания импорта: в её пределах ищем существующую организацию по ключу. */
  companyId?: string | null;
  overrides?: CounterpartyOverride[];
};

function bump(reasons: Record<string, number>, key: string) {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

export async function collectNewCounterparties(
  db: PrismaClient,
  queued: QueuedRow[],
  opts: Options = {}
): Promise<CollectResult> {
  const reasons: Record<string, number> = {};
  const badOverrides: string[] = [];
  const byKey = new Map<string, NewCounterparty>();

  for (const row of queued) {
    const name = row.counterpartyName?.trim() ?? '';
    const key = counterpartyKey(name).key;
    const inn = normalizeInn(row.counterpartyInn ?? '');
    const validInn = isValidInn(inn) ? inn : null;
    if (!key) {
      // Без названия создавать нечего: организация «без имени» бесполезна и
      // человеку, и матчеру (`У-92`).
      bump(reasons, 'no_name');
      continue;
    }
    const seen = byKey.get(key);
    if (seen) {
      seen.rows += 1;
      if (!seen.inn && validInn) {
        seen.inn = validInn;
        seen.innSource = 'file';
      }
      if (!seen.name && name) seen.name = name;
      continue;
    }
    byKey.set(key, {
      key,
      name,
      inn: validInn,
      innSource: validInn ? 'file' : null,
      rows: 1,
    });
  }

  const total = byKey.size;
  const existing: ExistingCounterparty[] = [];

  // 1) Дедуп по ИНН. `Organization.inn` уникален глобально, поэтому чужая
  //    компания — это не «привязать», а «в очередь»: платить за чужого клиента
  //    мы не имеем права (C8).
  const innList = [...byKey.values()].map((c) => c.inn).filter((x): x is string => !!x);
  if (innList.length > 0) {
    const found = await db.organization.findMany({
      where: { inn: { in: innList } },
      select: { id: true, inn: true, companyId: true },
    });
    for (const org of found) {
      const candidate = [...byKey.values()].find((c) => c.inn === org.inn);
      if (!candidate) continue;
      if (opts.companyId && org.companyId !== opts.companyId) {
        bump(reasons, 'inn_other_company');
      } else {
        existing.push({ key: candidate.key, organizationId: org.id, reason: 'inn' });
      }
      byKey.delete(candidate.key);
    }
  }

  // 2) Дедуп по ключу названия в компании импорта (`У-86`).
  if (opts.companyId && byKey.size > 0) {
    const found = await db.organization.findMany({
      where: { companyId: opts.companyId, nameKey: { in: [...byKey.keys()] } },
      select: { id: true, nameKey: true },
    });
    for (const org of found) {
      if (!org.nameKey || !byKey.has(org.nameKey)) continue;
      existing.push({ key: org.nameKey, organizationId: org.id, reason: 'name' });
      byKey.delete(org.nameKey);
    }
  }

  // 3) ИНН из ЕГРЮЛ — только тем, у кого его нет (`У-85`).
  const needInn = [...byKey.values()].filter((c) => !c.inn).map((c) => c.key);
  const dadata = await enrichInnByName(db, needInn);
  for (const [key, hit] of dadata.byKey) {
    const candidate = byKey.get(key);
    if (!candidate) continue;
    candidate.inn = hit.inn;
    candidate.innSource = 'dadata';
    candidate.egrulName = hit.egrulName;
  }

  // 4) Правки человека поверх всего (`У-87`): его решение — последнее.
  for (const ov of opts.overrides ?? []) {
    const candidate = byKey.get(ov.key);
    if (!candidate) continue;
    if (ov.create === false) {
      byKey.delete(ov.key);
      bump(reasons, 'skipped_by_user');
      continue;
    }
    if (ov.inn !== undefined) {
      const manual = normalizeInn(ov.inn);
      if (manual === '') {
        candidate.inn = null;
        candidate.innSource = null;
        continue;
      }
      if (!isValidInn(manual)) {
        badOverrides.push(ov.key);
        continue;
      }
      candidate.inn = manual;
      candidate.innSource = 'manual';
      delete candidate.egrulName;
    }
  }

  const candidates = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { candidates, existing, reasons, badOverrides, dadata, total };
}
