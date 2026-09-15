import type { NotificationTypeKey } from '@/lib/notifications/registry';

/**
 * Каталоги правил автоматизации (`У-222`, `У-223`, решение `Р-Б-6`).
 *
 * ЗАЧЕМ ДВА СПИСКА В ОДНОМ ФАЙЛЕ. Главный риск роботов — зацикливание: правило
 * создаёт задачу, задача рождает событие, событие снова запускает правило. Оно
 * закрыто не осторожностью, а конструкцией: **множество того, что делают
 * действия, и множество того, на что подписаны триггеры, не пересекаются**.
 * Проверить это можно, только когда оба списка лежат рядом и каждый честно
 * говорит, какие сущности трогает, — отсюда поля `touches` и `entity`.
 * Страж `automation.no-loop` сверяет их пересечение и падает, если оно
 * непусто. Написан он ДО первого правила из коробки — так требует §5 ТЗ.
 *
 * ПРО СВЯЗЬ С РЕЕСТРОМ УВЕДОМЛЕНИЙ. Решение `Р-Б-6` говорит «правила слушают
 * реестр событий уведомлений». Шины событий в проекте нет: реестр — пассивный
 * каталог метаданных, а уведомления рождаются в девятнадцати местах двумя
 * независимыми путями. Поэтому триггер ссылается на реестр полем
 * `notificationType` там, где событие УЖЕ порождает уведомление (четыре из
 * восьми), а не заводит вторую параллельную систему событий. Для остальных
 * четырёх якорь один — `callSite`, файл, обязанный позвать
 * `emitAutomationEvent`; полноту врезки держит страж `automation.emit-coverage`.
 */

/** Что правило умеет ДЕЛАТЬ. `touches` — сущности, которые действие меняет. */
export type AutomationActionSpec = {
  labelRu: string;
  /** Какие сущности меняет действие. Сверяется с `entity` триггеров. */
  touches: readonly AutomationEntity[];
};

/**
 * Сущности, которыми оперируют правила. Отдельный тип, а не свободная строка:
 * опечатка в `touches` или `entity` сделала бы проверку непересечения ложно
 * зелёной, и страж молчал бы ровно там, где нужен.
 */
export type AutomationEntity =
  | 'task'
  | 'notification'
  | 'message'
  | 'order'
  | 'lead'
  | 'deal'
  | 'document'
  | 'payment'
  | 'client_request'
  | 'dialog';

export const AUTOMATION_ACTIONS = {
  create_task: {
    labelRu: 'Создать задачу',
    touches: ['task'],
  },
  notify: {
    labelRu: 'Отправить уведомление сотруднику',
    touches: ['notification'],
  },
  /**
   * `Р-Э4-13`: действие есть, но ни одно правило из коробки его не использует.
   * Робот, который сам пишет клиенту, включается осознанно.
   */
  send_message: {
    labelRu: 'Отправить сообщение клиенту',
    touches: ['message'],
  },
} as const satisfies Record<string, AutomationActionSpec>;

type AutomationActionKey = keyof typeof AUTOMATION_ACTIONS;

export type AutomationTriggerSpec = {
  labelRu: string;
  /** Сущность, изменение которой и есть событие. */
  entity: AutomationEntity;
  /**
   * Якорь в реестре уведомлений — если это событие уже кого-то уведомляет.
   * `null` — событие в системе происходит, но уведомления не порождает.
   */
  notificationType: NotificationTypeKey | null;
  /** Файл, обязанный позвать `emitAutomationEvent`. Проверяется стражем. */
  callSite: string;
  /** Человеческое пояснение: что именно считается этим событием. */
  hintRu: string;
};

export const AUTOMATION_TRIGGERS = {
  order_status_changed: {
    labelRu: 'Заказ сменил статус',
    entity: 'order',
    notificationType: 'order_status_changed',
    callSite: 'src/lib/services/orderStatuses/transitions.ts',
    hintRu: 'Статус заказа изменил сотрудник или обмен с 1С.',
  },
  lead_stage_changed: {
    labelRu: 'Лид сменил стадию',
    entity: 'lead',
    notificationType: null,
    callSite: 'src/lib/services/funnel/board.ts',
    hintRu: 'Лид перешёл на другую стадию воронки.',
  },
  deal_stage_changed: {
    labelRu: 'Сделка сменила стадию',
    entity: 'deal',
    notificationType: null,
    callSite: 'src/lib/services/deals/board.ts',
    hintRu: 'Карточку сделки перетащили в другую колонку воронки.',
  },
  document_issued: {
    labelRu: 'Документ выставлен',
    entity: 'document',
    notificationType: 'document_published',
    callSite: 'src/lib/services/documents/generate.ts',
    hintRu: 'Счёт, акт, договор или коммерческое предложение выпущены клиенту.',
  },
  payment_received: {
    labelRu: 'Платёж получен',
    entity: 'payment',
    notificationType: 'payment_received',
    callSite: 'src/lib/services/oneCSync/writers.ts',
    hintRu: 'По заказу зарегистрирован входящий платёж.',
  },
  client_request_submitted: {
    labelRu: 'Поступило обращение',
    entity: 'client_request',
    notificationType: 'client_request_submitted',
    // Врезка стоит у ОБЩЕГО нотификатора, а не у двух дверей подачи (кабинет и
    // форма сайта): обе они и так сходятся здесь, а две врезки однажды
    // разошлись бы.
    callSite: 'src/lib/services/clientRequests/notify.ts',
    hintRu: 'Клиент написал из кабинета или с формы на сайте.',
  },
  proposal_no_answer: {
    labelRu: 'КП без ответа',
    entity: 'document',
    notificationType: null,
    callSite: 'src/worker/processors/expire-proposals.ts',
    hintRu: 'Срок действия коммерческого предложения истёк, ответа не было.',
  },
  dialog_waiting_staff_overdue: {
    labelRu: 'Переписка без ответа дольше SLA',
    entity: 'dialog',
    notificationType: 'sla_escalation',
    callSite: 'src/worker/processors/sla-escalation.ts',
    hintRu: 'Клиент ждёт ответа дольше, чем позволяет SLA компании.',
  },
} as const satisfies Record<string, AutomationTriggerSpec>;

export type AutomationTriggerKey = keyof typeof AUTOMATION_TRIGGERS;

// Проверки «это известный триггер/действие?» появятся вместе с формой правила
// (PR-4), которая разбирает пользовательский ввод. Экспортировать их заранее
// нельзя: неиспользуемый экспорт — красная сборка (§12b).

/**
 * Сущности, которые меняют действия правил. Вынесено функцией, чтобы страж и
 * диспетчер считали одно и то же — а не каждый по-своему.
 */
export function entitiesTouchedByActions(): Set<AutomationEntity> {
  const out = new Set<AutomationEntity>();
  for (const spec of Object.values(AUTOMATION_ACTIONS)) {
    for (const entity of spec.touches) out.add(entity);
  }
  return out;
}

/** Сущности, изменение которых запускает правила. */
export function entitiesWatchedByTriggers(): Set<AutomationEntity> {
  const out = new Set<AutomationEntity>();
  for (const spec of Object.values(AUTOMATION_TRIGGERS)) out.add(spec.entity);
  return out;
}
