import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from './helpers/source';
import { AUTOMATION_TRIGGERS } from '@/lib/automation/catalog';
import { NOTIFICATION_TYPES } from '@/lib/notifications/registry';

/**
 * СТРАЖ `У-223`: каждый триггер реально врезан в код.
 *
 * Механизм, объявленный в каталоге, но не позванный в сервисе, — это худший
 * вид поломки: правило заводится, сохраняется, показывается человеку
 * включённым и **никогда не срабатывает**. Ни один тест бизнес-логики этого не
 * заметит, потому что бизнес-логика работает как прежде.
 *
 * Ровно этот класс в прогоне сопровождения №26 звучал как «механизм построен,
 * но его ничто не запускает», а в №28 — «страж видит одну форму нарушения из
 * трёх». Поэтому здесь проверяется не наличие функции, а наличие ВЫЗОВА в
 * заявленном файле — и через `readSource`, который снимает комментарии:
 * закомментированный вызов для продукта равен отсутствующему.
 */

const ROOT = process.cwd();

const triggers = Object.entries(AUTOMATION_TRIGGERS);

describe('страж: врезка событий правил (`У-223`)', () => {
  it('триггеров восемь — столько обещает пакет требований', () => {
    expect(triggers).toHaveLength(8);
  });

  it.each(triggers)('%s: файл-якорь существует', (_key, spec) => {
    expect(existsSync(join(ROOT, spec.callSite)), `нет файла ${spec.callSite}`).toBe(true);
  });

  it.each(triggers)('%s: в файле-якоре есть ЖИВОЙ вызов emitAutomationEvent', (key, spec) => {
    const src = readSource(join(ROOT, spec.callSite));
    expect(src, `${spec.callSite} не зовёт диспетчер`).toContain('emitAutomationEvent');
    // Именно с этим триггером, а не «вообще с каким-нибудь»: файл может
    // испускать соседнее событие, и тогда своё останется незамеченным.
    expect(src, `${spec.callSite} не испускает триггер ${key}`).toContain(`trigger: '${key}'`);
  });

  it.each(triggers)('%s: якорь в реестре уведомлений существует, если объявлен', (_key, spec) => {
    if (spec.notificationType === null) return;
    expect(
      Object.keys(NOTIFICATION_TYPES),
      `тип ${spec.notificationType} пропал из реестра уведомлений`
    ).toContain(spec.notificationType);
  });

  it('ни один триггер не остался без якоря вообще', () => {
    // `callSite` обязателен всем; `notificationType` — только тем, у кого
    // событие уже кого-то уведомляет (четыре из восьми). Триггер без обоих был
    // бы объявлением без точки опоры.
    for (const [key, spec] of triggers) {
      expect(spec.callSite, `${key} без файла-якоря`).toBeTruthy();
    }
    const anchored = triggers.filter(([, s]) => s.notificationType !== null);
    expect(anchored.length, 'связь с реестром уведомлений потеряна целиком').toBeGreaterThan(0);
  });

  it('очередь исполнения объявлена, а процессор зарегистрирован в воркере', () => {
    // Диспетчер может ставить задачи в очередь, которую никто не слушает —
    // внешне это выглядит как «правило просто не сработало».
    const queues = readSource(join(ROOT, 'src/lib/jobs/queues.ts'));
    expect(queues).toContain("'automation.run'");
    const worker = readSource(join(ROOT, 'src/worker/index.ts'));
    expect(worker).toContain("startWorker('automation.run'");
  });
});
