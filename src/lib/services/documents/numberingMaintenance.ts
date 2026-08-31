import type { PrismaClient } from '@prisma/client';

/**
 * Разбор исторических номеров документов перед включением уникальности
 * (`У-151`, дефекты `Д-3`, `Д-4`, `Д-21`).
 *
 * **Почему это не одна миграция.** Ограничение базы либо встаёт, либо валит
 * выкладку целиком — посреди неё, когда откатывать уже дорого. Поэтому работа
 * разделена на три шага, и порядок важен:
 *
 * 1. `npm run report:document-numbers` — только читает и говорит, что не так;
 * 2. `npm run fix:document-numbers` — чинит, сохраняя прежние значения для
 *    отката и печатая «до/после»;
 * 3. миграция — проверяет, что чисто, и вешает связи и уникальный индекс;
 *    если не чисто, падает внятным текстом, а не ошибкой Postgres.
 *
 * **Компания у документа лежит в двух местах.** У документа заказа — в заказе,
 * у документа без заказа — в самом документе (`У-145`). Наивная группировка по
 * `Document.companyId` увидела бы пустоту там, где живёт большинство
 * документов, и отчёт честно сказал бы «дублей нет» перед тем, как уронить
 * прод. Поэтому везде считается «эффективная компания».
 */

/** Группа документов, претендующих на один и тот же номер. */
export type DuplicateGroup = {
  companyId: string;
  type: string;
  number: string;
  version: number;
  /** По возрастанию даты выпуска: первый остаётся как есть. */
  documentIds: string[];
};

/** Акт или ДС без явной связи с ведущим документом. */
export type MissingParent = {
  documentId: string;
  type: string;
  number: string;
  orderId: string;
  /** Ведущий документ того же заказа с тем же номером. */
  candidateId: string;
};

export type OrphanReplaces = { documentId: string; replacesDocumentId: string };
export type OrphanCounter = { companyId: string; year: number; kind: string };
/** Документ заказа, у заказа которого нет компании: чинить его нечем. */
export type CompanylessDocument = { documentId: string; orderId: string };

export type NumberingIssues = {
  duplicates: DuplicateGroup[];
  missingParents: MissingParent[];
  orphanReplaces: OrphanReplaces[];
  orphanCounters: OrphanCounter[];
  companyless: CompanylessDocument[];
};

export function isClean(issues: NumberingIssues): boolean {
  return (
    issues.duplicates.length === 0 &&
    issues.missingParents.length === 0 &&
    issues.orphanReplaces.length === 0 &&
    issues.orphanCounters.length === 0 &&
    issues.companyless.length === 0
  );
}

/**
 * Что мешает включить уникальность. Только читает — ни одной записи.
 */
export async function findNumberingIssues(prisma: PrismaClient): Promise<NumberingIssues> {
  const duplicates = await prisma.$queryRawUnsafe<
    Array<{ companyid: string; type: string; number: string; version: number; ids: string[] }>
  >(`
    SELECT coalesce(d."companyId", o."companyId") AS companyid,
           d."type"::text AS type,
           d."number" AS number,
           d."version" AS version,
           array_agg(d."id" ORDER BY d."createdAt", d."id") AS ids
      FROM "Document" d
      LEFT JOIN "Order" o ON o."id" = d."orderId"
     WHERE d."number" IS NOT NULL
       AND coalesce(d."companyId", o."companyId") IS NOT NULL
     GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
     ORDER BY 1, 2, 3, 4
  `);

  const missingParents = await prisma.$queryRawUnsafe<
    Array<{
      documentid: string;
      type: string;
      number: string;
      orderid: string;
      candidateid: string;
    }>
  >(`
    SELECT d."id" AS documentid,
           d."type"::text AS type,
           d."number" AS number,
           d."orderId" AS orderid,
           lead."id" AS candidateid
      FROM "Document" d
      JOIN LATERAL (
        SELECT l."id"
          FROM "Document" l
         WHERE l."orderId" = d."orderId"
           AND l."number" = d."number"
           AND l."type"::text = CASE d."type"::text
                                  WHEN 'act' THEN 'invoice'
                                  WHEN 'extra_agreement' THEN 'contract'
                                END
         ORDER BY l."createdAt", l."id"
         LIMIT 1
      ) lead ON true
     WHERE d."parentDocumentId" IS NULL
       AND d."orderId" IS NOT NULL
       AND d."number" IS NOT NULL
       AND d."type"::text IN ('act', 'extra_agreement')
     ORDER BY d."createdAt", d."id"
  `);

  const orphanReplaces = await prisma.$queryRawUnsafe<
    Array<{ documentid: string; replacesdocumentid: string }>
  >(`
    SELECT d."id" AS documentid, d."replacesDocumentId" AS replacesdocumentid
      FROM "Document" d
     WHERE d."replacesDocumentId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM "Document" x WHERE x."id" = d."replacesDocumentId")
     ORDER BY d."id"
  `);

  const orphanCounters = await prisma.$queryRawUnsafe<
    Array<{ companyid: string; year: number; kind: string }>
  >(`
    SELECT dc."companyId" AS companyid, dc."year" AS year, dc."kind" AS kind
      FROM "DocumentCounter" dc
     WHERE NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = dc."companyId")
     ORDER BY 1, 2, 3
  `);

  const companyless = await prisma.$queryRawUnsafe<Array<{ documentid: string; orderid: string }>>(`
    SELECT d."id" AS documentid, d."orderId" AS orderid
      FROM "Document" d
      JOIN "Order" o ON o."id" = d."orderId"
     WHERE d."companyId" IS NULL
       AND o."companyId" IS NULL
     ORDER BY d."id"
  `);

  return {
    duplicates: duplicates.map((r) => ({
      companyId: r.companyid,
      type: r.type,
      number: r.number,
      version: Number(r.version),
      documentIds: r.ids,
    })),
    missingParents: missingParents.map((r) => ({
      documentId: r.documentid,
      type: r.type,
      number: r.number,
      orderId: r.orderid,
      candidateId: r.candidateid,
    })),
    orphanReplaces: orphanReplaces.map((r) => ({
      documentId: r.documentid,
      replacesDocumentId: r.replacesdocumentid,
    })),
    orphanCounters: orphanCounters.map((r) => ({
      companyId: r.companyid,
      year: Number(r.year),
      kind: r.kind,
    })),
    companyless: companyless.map((r) => ({ documentId: r.documentid, orderId: r.orderid })),
  };
}

export type FixReport = {
  /** Документы заказа, которым проставлена компания заказа. */
  companyBackfilled: number;
  /** Документы, которым поднята версия ради развода дублей. */
  versionsBumped: Array<{ documentId: string; from: number; to: number }>;
  /** Акты и ДС, которым проставлена связь с ведущим документом. */
  parentsLinked: number;
  /** Осиротевшие ссылки на заменённый документ, которые обнулены. */
  orphanReplacesCleared: number;
  /** Счётчики номеров без компании, которые удалены. */
  orphanCountersDeleted: number;
};

/**
 * Разобрать историю. Пишет — но каждое изменение сначала попадает в таблицу
 * отката `DocumentNumberingBackup`, поэтому «до» не теряется.
 *
 * Документы заказов без компании НЕ чинятся: подставить им компанию неоткуда,
 * а выдумывать её значило бы приписать чужую бумагу чужому юрлицу. Такие
 * строки остаются в отчёте, и миграция из-за них честно откажется работать.
 */
export async function fixNumberingIssues(prisma: PrismaClient): Promise<FixReport> {
  const issues = await findNumberingIssues(prisma);

  return prisma.$transaction(async (tx) => {
    const stamp = new Date();

    // 1. Компания документа заказа — из заказа. Делается первым: и развод
    //    дублей, и уникальный индекс считают именно по ней.
    const backfilled = await tx.$executeRawUnsafe(`
      UPDATE "Document" d
         SET "companyId" = o."companyId"
        FROM "Order" o
       WHERE o."id" = d."orderId"
         AND d."companyId" IS NULL
         AND o."companyId" IS NOT NULL
    `);

    // 2. Дубли разводятся версиями: самый ранний документ группы остаётся как
    //    есть, каждому следующему версия поднимается до первой свободной.
    //    Номер НЕ трогаем: он напечатан в PDF и назван в имени файла.
    const bumped: FixReport['versionsBumped'] = [];
    for (const group of issues.duplicates) {
      const taken = await tx.$queryRawUnsafe<Array<{ version: number }>>(
        `SELECT DISTINCT d."version" AS version
           FROM "Document" d
           LEFT JOIN "Order" o ON o."id" = d."orderId"
          WHERE coalesce(d."companyId", o."companyId") = $1
            AND d."type"::text = $2
            AND d."number" = $3`,
        group.companyId,
        group.type,
        group.number
      );
      const used = new Set(taken.map((r) => Number(r.version)));
      // Первый остаётся при своей версии — его бумага уже у клиента.
      for (const documentId of group.documentIds.slice(1)) {
        let next = group.version + 1;
        while (used.has(next)) next += 1;
        used.add(next);
        await tx.$executeRawUnsafe(
          `INSERT INTO "DocumentNumberingBackup"
             ("id","documentId","field","oldValue","createdAt")
           VALUES (gen_random_uuid()::text, $1, 'version', $2, $3)`,
          documentId,
          String(group.version),
          stamp
        );
        await tx.$executeRawUnsafe(
          `UPDATE "Document" SET "version" = $1 WHERE "id" = $2`,
          next,
          documentId
        );
        bumped.push({ documentId, from: group.version, to: next });
      }
    }

    // 3. Связь «акт → счёт», «ДС → договор» по совпадению номера внутри заказа.
    let parentsLinked = 0;
    for (const row of issues.missingParents) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "DocumentNumberingBackup"
           ("id","documentId","field","oldValue","createdAt")
         VALUES (gen_random_uuid()::text, $1, 'parentDocumentId', NULL, $2)`,
        row.documentId,
        stamp
      );
      await tx.$executeRawUnsafe(
        `UPDATE "Document" SET "parentDocumentId" = $1 WHERE "id" = $2`,
        row.candidateId,
        row.documentId
      );
      parentsLinked += 1;
    }

    // 4. Ссылки в никуда обнуляются: внешний ключ на них не встанет, а
    //    показывать «заменён документом, которого нет» бессмысленно.
    let orphanReplacesCleared = 0;
    for (const row of issues.orphanReplaces) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "DocumentNumberingBackup"
           ("id","documentId","field","oldValue","createdAt")
         VALUES (gen_random_uuid()::text, $1, 'replacesDocumentId', $2, $3)`,
        row.documentId,
        row.replacesDocumentId,
        stamp
      );
      await tx.$executeRawUnsafe(
        `UPDATE "Document" SET "replacesDocumentId" = NULL WHERE "id" = $1`,
        row.documentId
      );
      orphanReplacesCleared += 1;
    }

    // 5. Счётчик без компании ничего не нумерует — удаляем. Отката ему не
    //    нужно: восстановить его не из чего и незачем.
    const countersDeleted = await tx.$executeRawUnsafe(`
      DELETE FROM "DocumentCounter" dc
       WHERE NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = dc."companyId")
    `);

    return {
      companyBackfilled: backfilled,
      versionsBumped: bumped,
      parentsLinked,
      orphanReplacesCleared,
      orphanCountersDeleted: countersDeleted,
    };
  });
}
