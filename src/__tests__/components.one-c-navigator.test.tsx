import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OneCNavigator } from '@/components/settings/one-c-navigator';

/**
 * Навигатор задачи (`У-47`, этап 7). Раньше вход в раздел молча перебрасывал на
 * форму загрузки Excel — человек оказывался в форме, не поняв, туда ли пришёл.
 * Тест держит главное: вопросы сформулированы задачей пользователя, у каждой
 * карточки есть действие, и ведут они на свои вкладки (§15).
 */
function render(cabinet?: 'admin' | 'leader'): string {
  return renderToString(cabinet ? <OneCNavigator cabinet={cabinet} /> : <OneCNavigator />).replace(
    /<!-- -->/g,
    ''
  );
}

describe('OneCNavigator (У-47)', () => {
  it('спрашивает задачу, а не формат файла', () => {
    const html = render();
    expect(html).toContain('Что вы хотите сделать?');
    expect(html).toContain('Завести клиентов и заказы из 1С');
    expect(html).toContain('Разнести оплаты из банка');
    expect(html).toContain('Настроить постоянный обмен по сети');
    // `У-173`: четвёртая задача — отдать документы в 1С файлом.
    expect(html).toContain('Передать документы в 1С файлом');
  });

  it('у каждой карточки есть понятное действие (§15 «что дальше»)', () => {
    const html = render();
    expect(html).toContain('Загрузить файл Excel');
    expect(html).toContain('Загрузить выписку');
    expect(html).toContain('Открыть автообмен');
    expect(html).toContain('Собрать пакет');
    // И подсказка, где смотреть уже загруженное.
    expect(html).toContain('История');
  });

  it('ведёт на вкладки своего кабинета', () => {
    const admin = render('admin');
    expect(admin).toContain('href="/admin/settings/integrations/1c/excel"');
    expect(admin).toContain('href="/admin/settings/integrations/1c/payments"');
    expect(admin).toContain('href="/admin/settings/integrations/1c/auto"');
    expect(admin).toContain('href="/admin/settings/integrations/1c/documents"');

    const leader = render('leader');
    expect(leader).toContain('href="/leader/settings/integrations/1c/excel"');
    expect(leader).not.toContain('/admin/');
  });
});
