import { describe, it, expect } from 'vitest';
import {
  startOfMoscowDay,
  isProposalExpired,
  expiredProposalsWhere,
  proposalDisplayStatus,
} from '@/lib/documents/proposalExpiry';

/**
 * `У-164` (этап 7) — истечение срока коммерческого предложения.
 *
 * Здесь проверяется не «работает ли функция», а два обещания, на которых
 * держится требование:
 *
 * 1. **граница суток по МОСКВЕ**, а не по поясу процесса. Сервер работает в
 *    UTC, и `setHours(0,0,0,0)` дал бы разные ответы на машине разработчика и
 *    на проде — тот же дефект уже ловили у года номера документа (`Д-22`);
 * 2. **чистая функция и выборка отвечают ОДИНАКОВО.** Требование просит и
 *    проверку при чтении, и ночную задачу; разъедься они — экран скажет «ещё
 *    действует», а задача в ту же секунду переведёт бумагу в «истёк срок».
 */
const KP = (validUntil: string | null, status = 'sent') => ({
  type: 'commercial_proposal',
  status,
  validUntil: validUntil === null ? null : new Date(validUntil),
});

describe('граница суток', () => {
  it('считается по Москве, а не по поясу процесса', () => {
    // 31 августа 21:00 UTC — это уже 1 сентября по Москве. Наивный расчёт
    // отдал бы 31 августа, и предложение со сроком «31.08» прожило бы лишний
    // день.
    expect(startOfMoscowDay(new Date('2026-08-31T21:00:00.000Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z'
    );
    // За минуту до московской полуночи — ещё прежние сутки.
    expect(startOfMoscowDay(new Date('2026-08-31T20:59:00.000Z')).toISOString()).toBe(
      '2026-08-31T00:00:00.000Z'
    );
  });
});

describe('isProposalExpired', () => {
  it('предложение действует ВЕСЬ последний день', () => {
    // В бумаге напечатано «Срок действия: до 16.09.2026». Клиент, открывший
    // письмо утром 16-го, не должен получить «истекло» — это выглядит обманом.
    const doc = KP('2026-09-16');
    expect(isProposalExpired(doc, new Date('2026-09-16T00:00:00.000Z'))).toBe(false);
    // 23:59 по Москве 16-го = 20:59 UTC.
    expect(isProposalExpired(doc, new Date('2026-09-16T20:59:59.000Z'))).toBe(false);
    // 00:00 по Москве 17-го = 21:00 UTC 16-го.
    expect(isProposalExpired(doc, new Date('2026-09-16T21:00:00.000Z'))).toBe(true);
  });

  it('вчерашний срок с ненулевым временем — истёк', () => {
    // Ловушка формулы «разница в сутках < 0»: она даёт `-0`, а `-0 < 0` — это
    // `false`. Функция сказала бы «действует», а выборка — «истекло».
    expect(
      isProposalExpired(KP('2026-09-15T12:00:00.000Z'), new Date('2026-09-16T09:00:00.000Z'))
    ).toBe(true);
  });

  it('без срока не истекает: обещания «до когда» не давали', () => {
    expect(isProposalExpired(KP(null), new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('ЧЕРНОВИК не истекает, даже если дата прошла', () => {
    // Срок стоит уже у черновика — он проставляется при выпуске. Но клиенту
    // черновик не отправляли, и писать «Истёк срок» было бы неправдой.
    expect(isProposalExpired(KP('2026-01-01', 'draft'), new Date('2026-09-16T09:00:00.000Z'))).toBe(
      false
    );
  });

  it('принятое и отклонённое не истекают: ответ клиента уже получен', () => {
    for (const status of ['accepted', 'rejected', 'cancelled', 'expired']) {
      expect(
        isProposalExpired(KP('2026-01-01', status), new Date('2026-09-16T09:00:00.000Z')),
        status
      ).toBe(false);
    }
  });

  it('не-предложение не истекает: у счёта и договора срока действия нет', () => {
    expect(
      isProposalExpired(
        { type: 'invoice', status: 'sent', validUntil: new Date('2026-01-01') },
        new Date('2026-09-16T09:00:00.000Z')
      )
    ).toBe(false);
  });
});

describe('expiredProposalsWhere — парный строитель', () => {
  it('повторяет ВСЕ четыре условия чистой функции', () => {
    const now = new Date('2026-09-16T21:00:00.000Z');
    expect(expiredProposalsWhere(now)).toEqual({
      type: 'commercial_proposal',
      status: 'sent',
      validUntil: { not: null, lt: new Date('2026-09-17T00:00:00.000Z') },
    });
  });

  /**
   * Главная проверка файла: функция и выборка обязаны отвечать ОДИНАКОВО.
   *
   * Условие выборки здесь исполняется вручную — той же логикой, что применил
   * бы Postgres. Разойдись хоть одно условие, и таблица ниже даст разные
   * ответы: именно так расхождение и обнаружится, а не в проде через месяц.
   */
  it('отвечает так же, как чистая функция, на всех краевых случаях', () => {
    const now = new Date('2026-09-16T21:00:00.000Z'); // 00:00 МСК 17 сентября
    const where = expiredProposalsWhere(now);
    const cutoff = (where.validUntil as { lt: Date }).lt;

    const cases = [
      KP('2026-09-16'),
      KP('2026-09-17'),
      KP('2026-09-15T23:59:59.000Z'),
      KP(null),
      KP('2026-01-01', 'draft'),
      KP('2026-01-01', 'accepted'),
      { type: 'invoice', status: 'sent', validUntil: new Date('2026-01-01') },
    ];

    for (const doc of cases) {
      const byWhere =
        doc.type === where.type &&
        doc.status === where.status &&
        doc.validUntil !== null &&
        doc.validUntil.getTime() < cutoff.getTime();
      expect(byWhere, `${doc.type}/${doc.status}/${String(doc.validUntil)}`).toBe(
        isProposalExpired(doc, now)
      );
    }
  });
});

describe('proposalDisplayStatus', () => {
  it('истёкшее показывается истёкшим, не дожидаясь ночной задачи', () => {
    // Иначе человек увидит «Отправлен» у бумаги, которую клиент уже не примет,
    // и нажмёт «Принять», чтобы получить отказ.
    expect(proposalDisplayStatus(KP('2026-09-16'), new Date('2026-09-16T21:00:00.000Z'))).toBe(
      'expired'
    );
  });

  it('всё остальное показывается как есть — расчёт не подменяет хранимое', () => {
    expect(proposalDisplayStatus(KP('2026-09-30'), new Date('2026-09-16T09:00:00.000Z'))).toBe(
      'sent'
    );
    expect(
      proposalDisplayStatus(KP('2026-01-01', 'accepted'), new Date('2026-09-16T09:00:00.000Z'))
    ).toBe('accepted');
  });
});
