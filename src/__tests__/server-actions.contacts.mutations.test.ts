import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireSession,
  requireManager,
  getCompanyTeamVisibility,
  notFoundIfDisabled,
  revalidatePath,
  updateContact,
  archiveContact,
  restoreContact,
  addChannel,
  removeChannel,
  setPrimaryChannel,
  mergeContacts,
  listMergeCandidates,
  createContact,
  createLeadFromContact,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireManager: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  revalidatePath: vi.fn(),
  updateContact: vi.fn(),
  archiveContact: vi.fn(),
  restoreContact: vi.fn(),
  addChannel: vi.fn(),
  removeChannel: vi.fn(),
  setPrimaryChannel: vi.fn(),
  mergeContacts: vi.fn(),
  listMergeCandidates: vi.fn(),
  createContact: vi.fn(),
  createLeadFromContact: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession, requireManager }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/telephony/bindCall', () => ({ bindCall: vi.fn() }));
vi.mock('@/lib/services/manager/contacts', () => ({ createContact }));
vi.mock('@/lib/services/intake/convert', () => ({ createLeadFromContact }));
vi.mock('@/lib/services/inbound/createContactFromInbound', () => ({
  createContactFromInbound: vi.fn(),
}));
vi.mock('@/lib/services/contacts/mutate', () => ({
  updateContact,
  archiveContact,
  restoreContact,
  addChannel,
  removeChannel,
  setPrimaryChannel,
}));
vi.mock('@/lib/services/contacts/merge', () => ({ mergeContacts, listMergeCandidates }));

import {
  addChannelAction,
  archiveContactAction,
  createContactAction,
  createLeadFromContactAction,
  listMergeCandidatesAction,
  mergeContactsAction,
  removeChannelAction,
  restoreContactAction,
  setPrimaryChannelAction,
  updateContactAction,
} from '@/server-actions/contacts';

/**
 * Server actions правок и объединения контактов (этап 1 ТЗ 12.09.2026, PR-1,
 * спека §3.4–§3.5): флаг `contacts` → `forbidden` без похода за сессией; форма —
 * zod → `validation`; `teamMode` читается свежим из базы и передаётся сервису;
 * после удачной записи перечитываются список и карточка в трёх кабинетах.
 *
 * PR-2 (спека §3.3, §3.12): `createContactAction` — создание из справочника с
 * нормализованной формой (организация `null`, когда не передана; должность и
 * заметка — только если заданы) и подсказкой занятого канала как есть;
 * `createLeadFromContactAction` — «Создать лид» из карточки: сервису уходят
 * только тема и заметка, ответ — идентификатор лида, перечитывается `/manager/leads`.
 */
const session = { sub: 'm1', role: 'manager', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(session);
  getCompanyTeamVisibility.mockResolvedValue(true);
  notFoundIfDisabled.mockReturnValue(null);
});

const cabinets = ['manager', 'leader', 'admin'];

describe('флаг и форма', () => {
  it('выключенный флаг → forbidden до сессии и сервиса — у всех восьми действий', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const results = await Promise.all([
      updateContactAction({ id: 'k1', name: 'Иван' }),
      archiveContactAction({ id: 'k1' }),
      restoreContactAction({ id: 'k1' }),
      addChannelAction({ contactId: 'k1', type: 'phone', value: '+79990000000' }),
      removeChannelAction({ channelId: 'ch1' }),
      setPrimaryChannelAction({ channelId: 'ch1' }),
      mergeContactsAction({ primaryId: 'k1', secondaryId: 'k2' }),
      listMergeCandidatesAction({ excludeId: 'k1' }),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(requireSession).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(mergeContacts).not.toHaveBeenCalled();
  });

  it('кривая форма → validation без сессии и сервиса', async () => {
    expect(await updateContactAction({ id: '', name: 'Иван' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await archiveContactAction({ id: '' })).toEqual({ ok: false, error: 'validation' });
    expect(await restoreContactAction({ id: '' })).toEqual({ ok: false, error: 'validation' });
    expect(await addChannelAction({ contactId: 'k1', type: 'fax' as never, value: '1' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await removeChannelAction({ channelId: '' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await setPrimaryChannelAction({ channelId: '' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await mergeContactsAction({ primaryId: 'k1', secondaryId: '' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await listMergeCandidatesAction({ excludeId: '' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(requireSession).not.toHaveBeenCalled();
  });
});

describe('updateContactAction', () => {
  it('передаёт сервису сессию, свежий teamMode и форму; после успеха перечитывает три кабинета и карточку организации', async () => {
    updateContact.mockResolvedValue({ ok: true, contactId: 'k1' });
    const r = await updateContactAction({
      id: 'k1',
      name: 'Иван',
      position: 'директор',
      organizationId: 'o1',
    });
    expect(r).toEqual({ ok: true, contactId: 'k1' });
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(updateContact).toHaveBeenCalledWith({}, session, true, {
      id: 'k1',
      name: 'Иван',
      position: 'директор',
      organizationId: 'o1',
    });
    for (const c of cabinets) {
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/contacts`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/contacts/k1`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/organizations/o1`);
    }
  });

  it('отказ сервиса возвращается как есть и ничего не перечитывает', async () => {
    updateContact.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await updateContactAction({ id: 'k9', name: 'Иван' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('архив и возврат', () => {
  it('archiveContactAction / restoreContactAction: сервис + перечитывание без организации', async () => {
    archiveContact.mockResolvedValue({ ok: true, contactId: 'k1' });
    restoreContact.mockResolvedValue({ ok: true, contactId: 'k1' });
    expect(await archiveContactAction({ id: 'k1' })).toEqual({ ok: true, contactId: 'k1' });
    expect(await restoreContactAction({ id: 'k1' })).toEqual({ ok: true, contactId: 'k1' });
    expect(archiveContact).toHaveBeenCalledWith({}, session, true, { id: 'k1' });
    expect(restoreContact).toHaveBeenCalledWith({}, session, true, { id: 'k1' });
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/organizations/'));
  });

  it('отказы возвращаются как есть', async () => {
    archiveContact.mockResolvedValue({ ok: false, error: 'not_found' });
    restoreContact.mockResolvedValue({ ok: false, error: 'invalid' });
    expect(await archiveContactAction({ id: 'k1' })).toEqual({ ok: false, error: 'not_found' });
    expect(await restoreContactAction({ id: 'k1' })).toEqual({ ok: false, error: 'invalid' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('каналы', () => {
  it('addChannelAction прокидывает форму и подсказку занятого канала', async () => {
    addChannel.mockResolvedValue({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'k2', name: 'Петров' },
    });
    const r = await addChannelAction({
      contactId: 'k1',
      type: 'phone',
      value: '+7 921 000-00-00',
      makePrimary: true,
    });
    expect(r).toEqual({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'k2', name: 'Петров' },
    });
    expect(addChannel).toHaveBeenCalledWith({}, session, true, {
      contactId: 'k1',
      type: 'phone',
      value: '+7 921 000-00-00',
      makePrimary: true,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('удачное добавление, удаление и смена основного перечитывают карточку', async () => {
    addChannel.mockResolvedValue({ ok: true, contactId: 'k1' });
    removeChannel.mockResolvedValue({ ok: true, contactId: 'k1' });
    setPrimaryChannel.mockResolvedValue({ ok: true, contactId: 'k1' });
    expect(await addChannelAction({ contactId: 'k1', type: 'email', value: 'a@b.ru' })).toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(await removeChannelAction({ channelId: 'ch1' })).toEqual({ ok: true, contactId: 'k1' });
    expect(await setPrimaryChannelAction({ channelId: 'ch2' })).toEqual({
      ok: true,
      contactId: 'k1',
    });
    expect(removeChannel).toHaveBeenCalledWith({}, session, true, { channelId: 'ch1' });
    expect(setPrimaryChannel).toHaveBeenCalledWith({}, session, true, { channelId: 'ch2' });
    expect(revalidatePath.mock.calls.filter((c) => c[0] === '/manager/contacts/k1')).toHaveLength(
      3
    );
  });

  it('отказы каналов возвращаются как есть', async () => {
    removeChannel.mockResolvedValue({ ok: false, error: 'contact_channel_locked' });
    setPrimaryChannel.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await removeChannelAction({ channelId: 'ch1' })).toEqual({
      ok: false,
      error: 'contact_channel_locked',
    });
    expect(await setPrimaryChannelAction({ channelId: 'ch1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('объединение', () => {
  it('mergeContactsAction перечитывает и главного, и второго (его страница теперь редиректит)', async () => {
    mergeContacts.mockResolvedValue({ ok: true, primaryId: 'k1', moved: { channels: 1 } });
    const r = await mergeContactsAction({ primaryId: 'k1', secondaryId: 'k2' });
    expect(r).toEqual({ ok: true, primaryId: 'k1', moved: { channels: 1 } });
    expect(mergeContacts).toHaveBeenCalledWith({}, session, true, {
      primaryId: 'k1',
      secondaryId: 'k2',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/contacts/k1');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/contacts/k2');
  });

  it('отказ объединения — как есть, без перечитывания', async () => {
    mergeContacts.mockResolvedValue({ ok: false, error: 'contact_merge_two_users' });
    expect(await mergeContactsAction({ primaryId: 'k1', secondaryId: 'k2' })).toEqual({
      ok: false,
      error: 'contact_merge_two_users',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('listMergeCandidatesAction — поиск по мере ввода, без перечитывания', async () => {
    listMergeCandidates.mockResolvedValue({ ok: true, items: [] });
    expect(await listMergeCandidatesAction({ excludeId: 'k1', q: 'Пет' })).toEqual({
      ok: true,
      items: [],
    });
    expect(listMergeCandidates).toHaveBeenCalledWith({}, session, true, {
      excludeId: 'k1',
      q: 'Пет',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('createContactAction', () => {
  it('выключенный флаг → forbidden до сессии и сервиса', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect(await createContactAction({ name: 'Иван', channels: [] })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });

  it('кривая форма (пустое имя, чужой тип канала, больше 10 каналов) → validation без сессии', async () => {
    expect(await createContactAction({ name: '', channels: [] })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(
      await createContactAction({ name: 'Иван', channels: [{ type: 'fax' as never, value: '1' }] })
    ).toEqual({ ok: false, error: 'validation' });
    const tooMany = Array.from({ length: 11 }, (_, i) => ({
      type: 'phone' as const,
      value: `+7999000000${i}`,
    }));
    expect(await createContactAction({ name: 'Иван', channels: tooMany })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });

  it('минимальная форма: организация → null, должности и заметки в аргументах нет; перечитываются три кабинета без организации', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k1' });
    const r = await createContactAction({
      name: 'Иван',
      channels: [{ type: 'phone', value: '+79990000000' }],
    });
    expect(r).toEqual({ ok: true, contactId: 'k1' });
    expect(createContact).toHaveBeenCalledWith({}, session, {
      name: 'Иван',
      organizationId: null,
      channels: [{ type: 'phone', value: '+79990000000' }],
    });
    // Свежий teamMode этому действию не нужен — компанию и охват решает сервис.
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    for (const c of cabinets) {
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/contacts`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/contacts/k1`);
    }
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/organizations/'));
  });

  it('полная форма: должность, заметка и организация уходят сервису; перечитывается карточка организации', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k1' });
    await createContactAction({
      name: 'Иван',
      position: 'директор',
      note: 'звонить после обеда',
      organizationId: 'o1',
      channels: [],
    });
    expect(createContact).toHaveBeenCalledWith({}, session, {
      name: 'Иван',
      position: 'директор',
      note: 'звонить после обеда',
      organizationId: 'o1',
      channels: [],
    });
    for (const c of cabinets) expect(revalidatePath).toHaveBeenCalledWith(`/${c}/organizations/o1`);
  });

  it('организация null явно — сервису null, карточка организации не перечитывается', async () => {
    createContact.mockResolvedValue({ ok: true, contactId: 'k1' });
    await createContactAction({ name: 'Иван', organizationId: null, channels: [] });
    expect(createContact).toHaveBeenCalledWith(
      {},
      session,
      expect.objectContaining({ organizationId: null })
    );
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/organizations/'));
  });

  it('занятый канал прокидывается как есть с владельцем, без перечитывания', async () => {
    createContact.mockResolvedValue({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'k2', name: 'Петров' },
    });
    expect(
      await createContactAction({
        name: 'Иван',
        channels: [{ type: 'email', value: 'a@b.ru' }],
      })
    ).toEqual({
      ok: false,
      error: 'contact_channel_taken',
      conflict: { contactId: 'k2', name: 'Петров' },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('createLeadFromContactAction', () => {
  it('выключенный флаг → forbidden до сессии и сервиса', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect(await createLeadFromContactAction({ contactId: 'k1', subject: 'Обучение' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(createLeadFromContact).not.toHaveBeenCalled();
  });

  it('кривая форма (пустой контакт, пустая тема) → validation без сессии', async () => {
    expect(await createLeadFromContactAction({ contactId: '', subject: 'Обучение' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await createLeadFromContactAction({ contactId: 'k1', subject: '' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(createLeadFromContact).not.toHaveBeenCalled();
  });

  it('успех: сервису — контакт, свежий teamMode, тема и заметка; ответ — leadId; перечитывается список лидов', async () => {
    createLeadFromContact.mockResolvedValue({ ok: true, lead: { id: 'l1' } });
    const r = await createLeadFromContactAction({
      contactId: 'k1',
      subject: 'Обучение по ОТ',
      notes: 'перезвонить',
    });
    expect(r).toEqual({ ok: true, leadId: 'l1' });
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(createLeadFromContact).toHaveBeenCalledWith({}, session, {
      contactId: 'k1',
      teamMode: true,
      input: { subject: 'Обучение по ОТ', notes: 'перезвонить' },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/leads');
  });

  it('без заметки сервису уходит notes: null; teamMode false из базы передаётся как есть', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    createLeadFromContact.mockResolvedValue({ ok: true, lead: { id: 'l2' } });
    await createLeadFromContactAction({ contactId: 'k1', subject: 'Обучение' });
    expect(createLeadFromContact).toHaveBeenCalledWith({}, session, {
      contactId: 'k1',
      teamMode: false,
      input: { subject: 'Обучение', notes: null },
    });
  });

  it('отказы сервиса (not_found, validation с сообщениями) прокидываются как есть, без перечитывания', async () => {
    createLeadFromContact.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect(await createLeadFromContactAction({ contactId: 'k9', subject: 'Обучение' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    createLeadFromContact.mockResolvedValueOnce({
      ok: false,
      error: 'validation',
      messages: ['Укажите телефон или email для связи'],
    });
    expect(await createLeadFromContactAction({ contactId: 'k1', subject: 'Обучение' })).toEqual({
      ok: false,
      error: 'validation',
      messages: ['Укажите телефон или email для связи'],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
