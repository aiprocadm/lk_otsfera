import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DailyDigestTemplate,
  dailyDigestSubject,
  dailyDigestText,
  type DailyDigestProps,
} from '@/lib/email/templates/daily-digest';

/** Письмо дайджеста (`У-230`): список, «×N», «и ещё N», ссылка на кабинет. */

const props: DailyDigestProps = {
  recipientName: 'Ольга',
  period: 'с 16.09.2026 09:00 по 17.09.2026 09:00',
  count: 52,
  items: [
    {
      title: 'Назначена задача',
      body: 'Проверить документы',
      at: '17.09.2026 08:10',
      times: 3,
      url: 'https://lk/x/1',
    },
    {
      title: 'Изменился статус',
      body: 'Новый → В работе',
      at: '17.09.2026 07:00',
      times: 1,
      url: null,
    },
  ],
  moreCount: 50,
  cabinetUrl: 'https://lk/organization/notifications',
  itemsText: '• Назначена задача ×3 — 17.09.2026 08:10\n• Изменился статус — 17.09.2026 07:00',
};

describe('DailyDigestTemplate', () => {
  it('html: имя, число, строки с «×N» и ссылкой, «и ещё N», кнопка в кабинет', () => {
    const html = renderToStaticMarkup(<DailyDigestTemplate {...props} />);
    expect(html).toContain('Здравствуйте, Ольга!');
    expect(html).toContain('<strong>52</strong>');
    expect(html).toContain('Назначена задача');
    expect(html).toContain('×3');
    expect(html).toContain('href="https://lk/x/1"');
    expect(html).toContain('И ещё 50');
    expect(html).toContain('href="https://lk/organization/notifications"');
  });

  it('без хвоста «и ещё» и без ссылок у строк', () => {
    const html = renderToStaticMarkup(
      <DailyDigestTemplate {...props} moreCount={0} items={[props.items[1]!]} />
    );
    expect(html).not.toContain('И ещё');
    expect(html).not.toContain('Открыть</a>');
  });

  it('тема и текстовая версия', () => {
    expect(dailyDigestSubject(props)).toBe(
      'Дайджест уведомлений: 52 за с 16.09.2026 09:00 по 17.09.2026 09:00'
    );
    const text = dailyDigestText(props);
    expect(text).toContain('• Назначена задача ×3');
    expect(text).toContain('И ещё 50');
    expect(text).toContain('Все уведомления: https://lk/organization/notifications');
    expect(dailyDigestText({ ...props, moreCount: 0 })).not.toContain('И ещё');
  });
});
