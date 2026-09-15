// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { OrderDialogsPanel } from '@/components/orders/order-dialogs-panel';
import type { OrderDialogRow } from '@/lib/services/messengers/forOrder';

/**
 * Блок «Переписка с клиентом» в карточке заказа (`У-210`, этап 3 PR-6).
 *
 * Главное здесь — два РАЗНЫХ пустых состояния. «Переписки нет, напишите
 * первым» и «переписки нет, потому что писать некому» — это разные ответы на
 * вопрос «что делать дальше» (§15), и подменять второй первым нельзя: кнопка
 * увела бы человека в форму, где некого выбрать.
 *
 * Второе по важности — честность списка: панель короткая, и если диалогов
 * больше, чем показано, она обязана это сказать и увести за остальными
 * (`С-6`: молчаливое усечение — дефект, человек принимает пять строк за всю
 * переписку).
 */

const at = new Date('2026-09-10T10:00:00Z');

function makeRow(over: Partial<OrderDialogRow> = {}): OrderDialogRow {
  return {
    id: 'd1',
    channel: 'telegram',
    status: 'waiting_staff',
    peerLabel: 'Иван Петров',
    lastMessageAt: at,
    lastMessagePreview: 'когда пришлёте счёт?',
    ...over,
  };
}

const dialogHref = (id: string) => `/manager/messengers/${id}`;

describe('OrderDialogsPanel — заголовок и подзаголовок (§15)', () => {
  it('говорит, где я и что здесь, даже когда данных нет', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[]}
        total={0}
        dialogHref={null}
        writeFirstHref={null}
        allHref={null}
        hasContact={false}
      />
    );
    expect(container.textContent).toContain('Переписка с клиентом');
    expect(container.textContent).toContain('в мессенджерах и по почте');
  });
});

describe('OrderDialogsPanel — пусто, но контакт есть', () => {
  it('предлагает написать первым и ведёт в форму нового диалога', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[]}
        total={0}
        dialogHref={dialogHref}
        writeFirstHref="/manager/messengers?new=ct-1"
        allHref="/manager/organizations/org-1?tab=dialogs"
        hasContact
      />
    );
    expect(container.textContent).toContain('Переписки пока нет.');
    // Про отсутствующий контакт не врём — контакт есть.
    expect(container.textContent).not.toContain('связать разговор не с кем');
    expect(container.querySelector('a[href="/manager/messengers?new=ct-1"]')?.textContent).toBe(
      'Написать первым'
    );
    // Пустому списку нечего «показывать не полностью» — подписи об усечении нет.
    expect(container.textContent).not.toContain('Показаны последние');
  });

  it('у администратора ссылки нет: «Мессенджеры» живут в чужом кабинете (Model A)', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[]}
        total={0}
        dialogHref={null}
        writeFirstHref={null}
        allHref={null}
        hasContact
      />
    );
    expect(container.textContent).toContain('Переписки пока нет.');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('OrderDialogsPanel — пусто, потому что контакта нет', () => {
  it('честно называет причину и кнопку не показывает', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[]}
        total={0}
        dialogHref={dialogHref}
        // Даже если адрес формы передан, при отсутствии контакта кнопки быть не
        // должно: она вела бы в форму, где некого выбрать.
        writeFirstHref="/manager/messengers?new=ct-1"
        allHref={null}
        hasContact={false}
      />
    );
    expect(container.textContent).toContain('у заказа не указан контакт');
    expect(container.textContent).toContain('связать разговор не с кем');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('OrderDialogsPanel — список диалогов', () => {
  it('строка: собеседник, канал и состояние; ссылка ведёт в переписку', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[makeRow()]}
        total={1}
        dialogHref={dialogHref}
        writeFirstHref="/manager/messengers?new=ct-1"
        allHref="/manager/organizations/org-1?tab=dialogs"
        hasContact
      />
    );
    const link = container.querySelector('a[href="/manager/messengers/d1"]');
    expect(link?.textContent).toBe('Иван Петров · Telegram');
    expect(container.textContent).toContain('Ждёт ответа');
    expect(container.textContent).toContain('когда пришлёте счёт?');
    // Пустого состояния рядом с непустым списком быть не должно.
    expect(container.textContent).not.toContain('Переписки пока нет');
  });

  it('у администратора та же строка без ссылки', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[makeRow()]}
        total={1}
        dialogHref={null}
        writeFirstHref={null}
        allHref={null}
        hasContact
      />
    );
    expect(container.textContent).toContain('Иван Петров · Telegram');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('незнакомые канал и статус печатаются как есть, без начала реплики пусто не рисуем', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[
          makeRow({
            id: 'd2',
            channel: 'viber',
            status: 'в_архиве',
            lastMessagePreview: null,
          }),
        ]}
        total={1}
        dialogHref={dialogHref}
        writeFirstHref={null}
        allHref={null}
        hasContact
      />
    );
    expect(container.textContent).toContain('viber');
    expect(container.textContent).toContain('в_архиве');
    const paragraphs = [...container.querySelectorAll('li p')].map((p) => p.textContent);
    expect(paragraphs).toHaveLength(0);
  });

  it('список подписан для читалки с экрана — «Диалоги по заказу»', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[makeRow(), makeRow({ id: 'd2', channel: 'email', peerLabel: 'a@b.ru' })]}
        total={2}
        dialogHref={dialogHref}
        writeFirstHref={null}
        allHref={null}
        hasContact
      />
    );
    const list = container.querySelector('ul[aria-label="Диалоги по заказу"]');
    expect(list?.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('a@b.ru · Почта');
  });
});

describe('OrderDialogsPanel — «показаны не все» (С-6)', () => {
  it('когда диалогов больше, чем строк, панель это говорит и уводит за остальными', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[makeRow(), makeRow({ id: 'd2' })]}
        total={7}
        dialogHref={dialogHref}
        writeFirstHref={null}
        allHref="/manager/organizations/org-1?tab=dialogs"
        hasContact
      />
    );
    expect(container.textContent).toContain('Показаны последние 2 из 7.');
    expect(
      container.querySelector('a[href="/manager/organizations/org-1?tab=dialogs"]')?.textContent
    ).toBe('Вся переписка организации');
  });

  it('у администратора подпись остаётся, а ссылки нет — иначе он ушёл бы в отказ', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[makeRow()]}
        total={7}
        dialogHref={null}
        writeFirstHref={null}
        allHref={null}
        hasContact
      />
    );
    // Число важнее ссылки: без него список молча врал бы о полноте.
    expect(container.textContent).toContain('Показаны последние 1 из 7.');
    expect(container.textContent).not.toContain('Вся переписка организации');
  });

  it('когда показано всё — лишней подписи нет', () => {
    const { container } = render(
      <OrderDialogsPanel
        dialogs={[makeRow(), makeRow({ id: 'd2' })]}
        total={2}
        dialogHref={dialogHref}
        writeFirstHref={null}
        allHref="/manager/organizations/org-1?tab=dialogs"
        hasContact
      />
    );
    expect(container.textContent).not.toContain('Показаны последние');
    expect(
      container.querySelector('a[href="/manager/organizations/org-1?tab=dialogs"]')
    ).toBeNull();
  });
});
