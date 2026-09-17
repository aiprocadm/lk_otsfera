import * as React from 'react';
import { EmailLayout, emailStyles } from './layout';

/**
 * Дневной дайджест уведомлений (этап 5 ТЗ 12.09.2026, `У-230`, `Р-Э5-6`).
 * Одно письмо на все несрочные события за окно; срочные ушли сразу.
 * `itemsText` — тот же список строкой для переопределённого текста (`У-128`).
 */

export type DailyDigestItem = {
  title: string;
  body: string;
  /** Когда произошло (последний повтор), по Москве. */
  at: string;
  /** «×N» — сколько раз повторилось за окно. */
  times: number;
  url: string | null;
};

export type DailyDigestProps = {
  recipientName: string;
  period: string;
  count: number;
  items: DailyDigestItem[];
  /** Сколько событий не вошло в письмо (предел 50). */
  moreCount: number;
  cabinetUrl: string;
  itemsText: string;
};

export function DailyDigestTemplate({
  recipientName,
  period,
  count,
  items,
  moreCount,
  cabinetUrl,
}: DailyDigestProps) {
  return (
    <EmailLayout title="Ваш дайджест уведомлений">
      <p style={emailStyles.paragraph}>Здравствуйте, {recipientName}!</p>
      <p style={emailStyles.paragraph}>
        За период {period} в вашем кабинете произошло событий: <strong>{count}</strong>.
      </p>
      <ul style={{ paddingLeft: 18, margin: '0 0 16px' }}>
        {items.map((item, i) => (
          <li key={i} style={{ margin: '0 0 10px' }}>
            <strong>{item.title}</strong>
            {item.times > 1 ? ` ×${item.times}` : ''} — {item.at}
            <br />
            <span style={emailStyles.muted}>{item.body}</span>
            {item.url ? (
              <>
                <br />
                <a href={item.url}>Открыть</a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {moreCount > 0 ? (
        <p style={emailStyles.muted}>И ещё {moreCount} — смотрите в кабинете.</p>
      ) : null}
      <p style={emailStyles.paragraph}>
        <a href={cabinetUrl} style={emailStyles.button}>
          Все уведомления
        </a>
      </p>
      <p style={emailStyles.muted}>
        Дайджест приходит раз в день в выбранный вами час. Отключить его или изменить час можно в
        настройках кабинета, вкладка «Уведомления».
      </p>
    </EmailLayout>
  );
}

export function dailyDigestSubject({
  count,
  period,
}: Pick<DailyDigestProps, 'count' | 'period'>): string {
  return `Дайджест уведомлений: ${count} за ${period}`;
}

export function dailyDigestText({
  recipientName,
  period,
  count,
  itemsText,
  moreCount,
  cabinetUrl,
}: DailyDigestProps): string {
  return [
    `Здравствуйте, ${recipientName}!`,
    '',
    `За период ${period} в вашем кабинете произошло событий: ${count}.`,
    '',
    itemsText,
    ...(moreCount > 0 ? ['', `И ещё ${moreCount} — смотрите в кабинете.`] : []),
    '',
    `Все уведомления: ${cabinetUrl}`,
  ].join('\n');
}
