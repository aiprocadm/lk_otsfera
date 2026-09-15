// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { OrgDialogsSection } from '@/components/manager/org-dialogs-section';
import { OrgCardTabs } from '@/components/manager/org-card-tabs';
import { orgCardTabsFor } from '@/lib/navigation/orgCardTabs';
import type { OrganizationCard } from '@/lib/services/manager/organizationCard';

/**
 * Вкладка «Диалоги» карточки организации (`У-210`, этап 3 PR-6).
 *
 * Проверяем не «нарисовалось что-то», а три вопроса §15 на пустом и непустом
 * экране: что здесь (объяснение), что дальше (кнопка «Написать первым»), и куда
 * ведёт строка. Отдельно — кабинет администратора: у него ссылок в
 * `/manager/*` нет вовсе (Model A), и это ровно та ветка, где легко случайно
 * увести человека в «Доступ запрещён».
 */

type Dialog = OrganizationCard['dialogs'][number];

const at = new Date('2026-09-10T10:00:00Z');

function makeDialog(over: Partial<Dialog> = {}): Dialog {
  return {
    id: 'd1',
    channel: 'telegram',
    status: 'waiting_staff',
    peerDisplay: 'Иван Петров',
    peerRef: '@ivan',
    lastMessageAt: at,
    lastMessagePreview: 'нужен счёт на обучение',
    waitingSince: null,
    ...over,
  };
}

const dialogHref = (id: string) => `/manager/messengers/${id}`;

describe('OrgDialogsSection — пустая вкладка (У-74, У-210)', () => {
  it('объясняет, почему пусто, и даёт главное действие «Написать первым»', () => {
    const { container } = render(
      <OrgDialogsSection
        dialogs={[]}
        dialogHref={dialogHref}
        writeFirstHref="/manager/messengers?newOrg=org-1"
      />
    );

    // «Нет данных» в одиночку — дефект приёмки: экран обязан сказать, откуда
    // диалоги берутся и что нажать.
    expect(container.textContent).toContain('Переписки с этой организацией пока нет');
    expect(container.textContent).toContain('напишете ему первым');
    const action = container.querySelector('a[href="/manager/messengers?newOrg=org-1"]');
    expect(action?.textContent).toBe('Написать первым');
  });

  it('у администратора кнопки нет: вести в чужой кабинет некуда (Model A)', () => {
    const { container } = render(
      <OrgDialogsSection dialogs={[]} dialogHref={null} writeFirstHref={null} />
    );

    expect(container.textContent).toContain('Переписки с этой организацией пока нет');
    // Ни одной ссылки — ни кнопки, ни «сиротской» подсказки со ссылкой.
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('OrgDialogsSection — список диалогов (У-210)', () => {
  it('строка называет собеседника, канал, состояние и начало последней реплики', () => {
    const { container } = render(
      <OrgDialogsSection
        dialogs={[makeDialog()]}
        dialogHref={dialogHref}
        writeFirstHref="/manager/messengers?newOrg=org-1"
      />
    );

    const link = container.querySelector('a[href="/manager/messengers/d1"]');
    // Подписи канала и статуса — из общих реестров, а не свои слова вкладки
    // (правило зеркала §0.2: один объект — одно название везде).
    expect(link?.textContent).toBe('Иван Петров · Telegram');
    expect(container.textContent).toContain('Ждёт ответа');
    expect(container.textContent).toContain('нужен счёт на обучение');
    expect(container.textContent).toContain('Последнее сообщение:');
  });

  it('главное действие видно и при непустом списке — искать «Мессенджеры» не нужно', () => {
    const { container } = render(
      <OrgDialogsSection
        dialogs={[makeDialog()]}
        dialogHref={dialogHref}
        writeFirstHref="/manager/messengers?newOrg=org-1"
      />
    );
    const write = container.querySelector('a[href="/manager/messengers?newOrg=org-1"]');
    expect(write?.textContent).toBe('Написать первым');
  });

  it('без имени собеседника в заголовке стоит адрес, а пробелы именем не считаются', () => {
    const { container } = render(
      <OrgDialogsSection
        dialogs={[
          makeDialog({ id: 'd1', peerDisplay: null, peerRef: '+79990000000', channel: 'whatsapp' }),
          // Пустое имя из базы приходит не только как `null`: 1С и вебхуки
          // умеют класть строку из пробелов — она не должна стать заголовком.
          makeDialog({ id: 'd2', peerDisplay: '   ', peerRef: 'client@mail.ru', channel: 'email' }),
        ]}
        dialogHref={dialogHref}
        writeFirstHref={null}
      />
    );

    expect(container.querySelector('a[href="/manager/messengers/d1"]')?.textContent).toBe(
      '+79990000000 · WhatsApp'
    );
    expect(container.querySelector('a[href="/manager/messengers/d2"]')?.textContent).toBe(
      'client@mail.ru · Почта'
    );
  });

  it('незнакомый канал и статус печатаются как есть, а не пустотой', () => {
    // Значение из базы старше реестра (или из нового канала, которого ещё нет
    // в словаре): показать сырое значение честнее, чем пустое место.
    const { container } = render(
      <OrgDialogsSection
        dialogs={[makeDialog({ channel: 'viber', status: 'снято_с_учёта' })]}
        dialogHref={dialogHref}
        writeFirstHref={null}
      />
    );
    expect(container.textContent).toContain('viber');
    expect(container.textContent).toContain('снято_с_учёта');
  });

  it('без начала реплики строка остаётся, но пустого абзаца не рисует', () => {
    const { container } = render(
      <OrgDialogsSection
        dialogs={[makeDialog({ lastMessagePreview: null })]}
        dialogHref={dialogHref}
        writeFirstHref={null}
      />
    );
    const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs.every((t) => (t ?? '').trim().length > 0)).toBe(true);
  });

  it('администратор видит ту же строку, но без ссылки — заголовок становится текстом', () => {
    const { container } = render(
      <OrgDialogsSection dialogs={[makeDialog()]} dialogHref={null} writeFirstHref={null} />
    );

    expect(container.textContent).toContain('Иван Петров · Telegram');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

// ─── Вкладка внутри карточки: кто подставляет ссылку по умолчанию ────────────

/**
 * Карточка сама решает, куда ведёт строка, если кабинет ничего не передал:
 * менеджер и руководитель ссылку не задают, и она должна собраться сама.
 * Тест держит именно эту умолчательную ветку — пропущенный `dialogHref` не
 * должен молча превращать список в текст.
 */
function makeCard(dialogs: Dialog[]): OrganizationCard {
  return {
    name: 'ООО Ромашка',
    partner: null,
    inn: '1234567890',
    kpp: '987654321',
    commission: null,
    counts: { orders: 0, students: 0, cabinetUsers: 0, contacts: 0 },
    kpis: { activeOrders: 0, totalPaid: '0.00', debt: '0.00' },
    tabTotals: {
      orders: 0,
      documents: 0,
      payments: 0,
      activity: 0,
      inboundMessages: 0,
      dialogs: dialogs.length,
      calls: 0,
      clientRequests: 0,
      leads: 0,
      deals: 0,
      certificates: 0,
      enrollments: 0,
    },
    orders: [],
    documents: [],
    payments: [],
    activity: [],
    inboundMessages: [],
    dialogs,
    calls: [],
    requisites: {
      legalName: null,
      ogrn: null,
      legalAddress: null,
      bankName: null,
      bankAccount: null,
      corrAccount: null,
      bic: null,
      signerName: null,
      signerPosition: null,
      signerBasis: null,
    },
  } as unknown as OrganizationCard;
}

const STAFF_TABS = orgCardTabsFor('manager', { flags: () => true });

describe('OrgCardTabs — вкладка «Диалоги» (У-210)', () => {
  it('без переданной ссылки собирает адрес диалога сама', () => {
    const { container } = render(
      <OrgCardTabs
        card={makeCard([makeDialog()])}
        activeTab="dialogs"
        tabs={STAFF_TABS}
        writeFirstHref="/manager/messengers?newOrg=org-1"
      />
    );

    expect(container.querySelector('a[href="/manager/messengers/d1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/manager/messengers?newOrg=org-1"]')).not.toBeNull();
  });

  it('явный `dialogHref={null}` ссылку убирает (кабинет администратора)', () => {
    const { container } = render(
      <OrgCardTabs
        card={makeCard([makeDialog()])}
        activeTab="dialogs"
        tabs={STAFF_TABS}
        dialogHref={null}
        writeFirstHref={null}
      />
    );

    expect(container.querySelector('a[href="/manager/messengers/d1"]')).toBeNull();
    // Текст строки при этом на месте — админ переписку видит, просто не ходит.
    expect(container.textContent).toContain('Иван Петров · Telegram');
  });

  it('свой адрес диалога кабинет может задать сам', () => {
    const { container } = render(
      <OrgCardTabs
        card={makeCard([makeDialog()])}
        activeTab="dialogs"
        tabs={STAFF_TABS}
        dialogHref={(id) => `/leader/messengers/${id}`}
        writeFirstHref={null}
      />
    );
    expect(container.querySelector('a[href="/leader/messengers/d1"]')).not.toBeNull();
  });
});
