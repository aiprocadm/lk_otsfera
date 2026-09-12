// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import ManagerMessengerDialogPage from '@/app/manager/messengers/[id]/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getDialog, markDialogRead, listOrganizations } = vi.hoisted(() => ({
  getDialog: vi.fn(),
  markDialogRead: vi.fn(),
  listOrganizations: vi.fn(),
}));
vi.mock('@/lib/services/messengers/get', () => ({ getDialog, markDialogRead }));
vi.mock('@/lib/services/manager/organizations', () => ({ listOrganizations }));

vi.mock('@/components/manager/messengers/dialog-thread', () => ({
  DialogThread: (props: { messages: unknown[]; hiddenCount: number }) =>
    React.createElement('div', null, `ЛЕНТА:${props.messages.length}:${props.hiddenCount}`),
}));
vi.mock('@/components/manager/messengers/dialog-reply-form', () => ({
  DialogReplyForm: (props: { dialogId: string }) =>
    React.createElement('div', null, `ОТВЕТ:${props.dialogId}`),
}));
vi.mock('@/components/manager/messengers/dialog-bind-form', () => ({
  DialogBindForm: (props: { dialogId: string; organizations: unknown[] }) =>
    React.createElement('div', null, `ПРИВЯЗКА:${props.dialogId}:${props.organizations.length}`),
}));
vi.mock('@/components/manager/messengers/dialog-status-button', () => ({
  DialogStatusButton: (props: { status: string }) =>
    React.createElement('button', null, `СОСТОЯНИЕ:${props.status}`),
}));
vi.mock('@/components/intake/source-intake-actions', () => ({
  SourceIntakeActions: (props: {
    kind: string;
    sourceId: string;
    organizationId: string | null;
    leadPrefill: { companyName: string; contactPhone: string; subject: string };
    taskTitle: string;
  }) =>
    React.createElement(
      'div',
      null,
      `ДЕЙСТВИЯ:${props.kind}:${props.sourceId}:${String(props.organizationId)}:${props.leadPrefill.companyName}:${props.leadPrefill.contactPhone}:${props.taskTitle}`
    ),
}));

const SESSION = { sub: 'u1', role: 'manager' as const, companyId: 'c1' };

const dialog = {
  id: 'd1',
  channel: 'telegram',
  channelAvailable: true,
  peerLabel: 'Иван Петров',
  peerRef: 'chat-1',
  status: 'open',
  unreadCount: 0,
  bound: true,
  organization: { id: 'o1', name: 'Ромашка' },
  contact: { id: 'k1', name: 'Иван' },
  user: { id: 'cu1', name: 'Иван П.' },
  messages: [{ id: 'm1' }],
  hiddenCount: 0,
  lastInbound: { inboundMessageId: 'im-1', body: 'нужен счёт на обучение по электробезопасности' },
};

/**
 * Карточка диалога (спека 2026-09-12 §5.2): гейт, 404 для чужого, крошки и
 * шапка, ответ или подсказка о неподключённом канале, привязка ничьего,
 * действия по последнему входящему.
 */
describe('ManagerMessengerDialogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    requireManager.mockResolvedValue(SESSION);
    getDialog.mockResolvedValue({ ok: true, dialog });
    markDialogRead.mockResolvedValue(undefined);
    listOrganizations.mockResolvedValue([{ id: 'o1', name: 'Ромашка' }]);
  });

  it('флаг выключен → notFound; чужой или несуществующий диалог → notFound', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(
      ManagerMessengerDialogPage({ params: Promise.resolve({ id: 'd1' }) })
    ).rejects.toThrow('NOTFOUND');
    isFeatureEnabled.mockReturnValue(true);
    getDialog.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(
      ManagerMessengerDialogPage({ params: Promise.resolve({ id: 'x' }) })
    ).rejects.toThrow('NOTFOUND');
    expect(markDialogRead).not.toHaveBeenCalled();
  });

  it('привязанный диалог: крошки, шапка, лента, ответ, карточка организации, действия', async () => {
    const { container } = await renderServerComponent(
      ManagerMessengerDialogPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(getDialog).toHaveBeenCalledWith({}, SESSION, 'd1');
    expect(markDialogRead).toHaveBeenCalledWith({}, SESSION, 'd1');
    // Организации нужны только ничьему диалогу.
    expect(listOrganizations).not.toHaveBeenCalled();
    const text = container.textContent ?? '';
    expect(text).toContain('Мессенджеры');
    expect(text).toContain('Иван Петров');
    expect(text).toContain('Telegram · Ромашка');
    expect(text).toContain('ЛЕНТА:1:0');
    expect(text).toContain('ОТВЕТ:d1');
    expect(text).toContain('СОСТОЯНИЕ:open');
    expect(text).toContain('Контакт: Иван');
    expect(text).toContain('Пользователь кабинета: Иван П.');
    expect(container.querySelector('a[href="/manager/organizations/o1"]')).not.toBeNull();
    expect(text).not.toContain('ПРИВЯЗКА');
    expect(text).toContain(
      'ДЕЙСТВИЯ:inbound:im-1:o1:Ромашка::Telegram: нужен счёт на обучение по электробезопасности'
    );
  });

  it('ничей диалог: форма привязки со списком организаций, подсказка про очередь', async () => {
    getDialog.mockResolvedValue({
      ok: true,
      dialog: {
        ...dialog,
        channel: 'whatsapp',
        bound: false,
        organization: null,
        contact: null,
        user: { id: 'cu1', name: null },
        lastInbound: null,
      },
    });
    const { container } = await renderServerComponent(
      ManagerMessengerDialogPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(listOrganizations).toHaveBeenCalledWith({}, SESSION);
    const text = container.textContent ?? '';
    expect(text).toContain('WhatsApp · Диалог ещё не привязан к организации');
    expect(text).toContain('Не привязан');
    expect(text).toContain('ПРИВЯЗКА:d1:1');
    expect(text).toContain('без имени');
    expect(text).not.toContain('ДЕЙСТВИЯ');
  });

  it('канал не подключён — вместо формы честная подсказка; привязан без организации', async () => {
    getDialog.mockResolvedValue({
      ok: true,
      dialog: {
        ...dialog,
        channel: 'max',
        channelAvailable: false,
        organization: null,
        contact: null,
        user: null,
        lastInbound: { inboundMessageId: 'im-2', body: 'x' },
      },
    });
    const { container } = await renderServerComponent(
      ManagerMessengerDialogPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    const text = container.textContent ?? '';
    expect(text).toContain('MAX · Организация не указана');
    expect(text).toContain('Мессенджер MAX сейчас не подключён');
    expect(text).not.toContain('ОТВЕТ:');
    expect(text).toContain('ДЕЙСТВИЯ:inbound:im-2:null:Иван Петров::MAX: x');
  });

  it('WhatsApp: телефон собеседника попадает в заготовку лида', async () => {
    getDialog.mockResolvedValue({
      ok: true,
      dialog: { ...dialog, channel: 'whatsapp', peerRef: '+79990001122' },
    });
    const { container } = await renderServerComponent(
      ManagerMessengerDialogPage({ params: Promise.resolve({ id: 'd1' }) })
    );
    expect(container.textContent).toContain(':Ромашка:+79990001122:');
  });
});
