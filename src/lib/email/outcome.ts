import type { SendResult } from './send';

/**
 * Итог письма со ссылкой входа для человека (`У-271`, ТЗ 13.10.2026, `Д-54`).
 *
 * `send()` и раньше честно возвращал «пропущено: почта выключена / нет ключа»
 * или «провайдер отказал», но этот ответ никто не читал: приглашение говорило
 * «создано», а письмо не уходило вовсе — на стенде почта не была настроена.
 * Теперь итог переводится в фразу, которую видит администратор, и пишется в
 * журнал пользователя.
 */
export type EmailOutcome = { status: 'sent' } | { status: 'not_sent'; reason: string };

const NOT_SENT_REASON = {
  disabled: 'отправка писем выключена в «Настройки → Интеграции → Почта»',
  'no-api-key': 'не задан ключ почтового сервиса в «Настройки → Интеграции → Почта»',
  'no-recipient': 'у пользователя не указан e-mail',
  provider: 'почтовый сервис отказал в отправке',
} as const;

/** `null` — отправка упала исключением (сбой сети, шаблона). */
export function emailOutcome(result: SendResult | null): EmailOutcome {
  if (result === null) return { status: 'not_sent', reason: 'сбой при отправке письма' };
  if (result.status === 'sent') return { status: 'sent' };
  return { status: 'not_sent', reason: NOT_SENT_REASON[result.reason] };
}
