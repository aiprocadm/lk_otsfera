import { describe, expect, it } from 'vitest';

import {
  contactNotePrefix,
  planDealNote,
  planOrganizationNote,
} from '@/lib/services/bitrix/mapping/notes';
import type { MappingContext } from '@/lib/services/bitrix/mapping/types';
import type { BitrixComment } from '@/lib/services/bitrix/source';
import { NOTE_BODY_MAX } from '@/lib/services/organizationNotes/policy';

/**
 * Этап 2 ТЗ 12.09.2026 «Миграция из Битрикс24» (`У-191`): комментарии таймлайна
 * → заметки ЛК. Комментарий сделки ложится в заметку сделки, комментарий
 * компании — в заметку организации, комментарий контакта — в заметку ЕГО
 * организации с префиксом «О контакте …».
 */

const CREATED_AT = new Date('2025-10-07T10:00:00Z');

function ctxOf(over: Partial<MappingContext> = {}): MappingContext {
  return {
    companyId: 'company-1',
    importerId: 'user-importer',
    defaultManagerId: 'user-default',
    tables: { stageMap: {}, leadStageMap: {}, taskColumnMap: {}, userMap: {} },
    resolveUser: (id) => (id === '1' ? 'user-ivan' : null),
    ...over,
  };
}

function commentOf(over: Partial<BitrixComment> = {}): BitrixComment {
  return {
    id: '601',
    entity: 'deal',
    entityId: '401',
    authorId: '1',
    text: 'Клиент подтвердил список слушателей',
    createdAt: CREATED_AT,
    ...over,
  };
}

describe('contactNotePrefix — подпись заметки о контакте', () => {
  it('склеивается из имени контакта и двоеточия с пробелом', () => {
    expect(contactNotePrefix('Анна Иванова')).toBe('О контакте Анна Иванова: ');
  });
});

describe('planDealNote — комментарий сделки', () => {
  it('переносится как заметка сделки: текст, автор и дата оригинала', () => {
    const plan = planDealNote(commentOf(), ctxOf(), {
      dealByBitrixId: (id) => (id === '401' ? 'deal-1' : undefined),
    });

    expect(plan).toEqual({
      action: 'create',
      data: {
        dealId: 'deal-1',
        body: 'Клиент подтвердил список слушателей',
        authorId: 'user-ivan',
        createdAt: CREATED_AT,
      },
    });
  });

  it('текст обрезается по краям', () => {
    const plan = planDealNote(commentOf({ text: '  Счёт оплачен \n' }), ctxOf(), {
      dealByBitrixId: () => 'deal-1',
    });

    expect(plan).toMatchObject({ action: 'create', data: { body: 'Счёт оплачен' } });
  });

  it('автор не нашёлся среди сотрудников → заметка без автора', () => {
    const plan = planDealNote(commentOf({ authorId: null }), ctxOf(), {
      dealByBitrixId: () => 'deal-1',
    });

    expect(plan).toMatchObject({ action: 'create', data: { authorId: null } });
  });

  it('даты у комментария нет → переносим как есть', () => {
    const plan = planDealNote(commentOf({ createdAt: null }), ctxOf(), {
      dealByBitrixId: () => 'deal-1',
    });

    expect(plan).toMatchObject({ action: 'create', data: { createdAt: null } });
  });

  it('пустой текст → пропуск empty', () => {
    const plan = planDealNote(commentOf({ text: '   \n  ' }), ctxOf(), {
      dealByBitrixId: () => 'deal-1',
    });

    expect(plan).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('сделка не перенеслась → заметке некуда лечь', () => {
    const plan = planDealNote(commentOf(), ctxOf(), { dealByBitrixId: () => undefined });

    expect(plan).toEqual({ action: 'skip', reason: 'no_contact' });
  });

  it('длинный текст укорачивается до предела модели', () => {
    const plan = planDealNote(commentOf({ text: 'я'.repeat(NOTE_BODY_MAX + 500) }), ctxOf(), {
      dealByBitrixId: () => 'deal-1',
    });

    expect(plan).toMatchObject({ action: 'create' });
    expect(plan.action === 'create' && plan.data.body.length).toBe(NOTE_BODY_MAX);
  });
});

describe('planOrganizationNote — комментарий компании', () => {
  it('ищет организацию по идентификатору компании портала', () => {
    const plan = planOrganizationNote(
      commentOf({ id: '606', entity: 'company', entityId: '101', text: 'Звонить после 14:00' }),
      ctxOf(),
      {
        organizationByBitrixId: (id) => (id === '101' ? 'org-1' : undefined),
        contactOrganization: () => undefined,
      }
    );

    expect(plan).toEqual({
      action: 'create',
      data: {
        companyId: 'company-1',
        organizationId: 'org-1',
        body: 'Звонить после 14:00',
        authorId: 'user-ivan',
        createdAt: CREATED_AT,
      },
    });
  });

  it('организация не перенеслась → пропуск no_organization', () => {
    const plan = planOrganizationNote(commentOf({ entity: 'company', entityId: '999' }), ctxOf(), {
      organizationByBitrixId: () => undefined,
      contactOrganization: () => undefined,
    });

    expect(plan).toEqual({ action: 'skip', reason: 'no_organization' });
  });

  it('пустой текст компании → пропуск empty', () => {
    const plan = planOrganizationNote(
      commentOf({ id: '610', entity: 'company', entityId: '105', text: '' }),
      ctxOf(),
      { organizationByBitrixId: () => 'org-1', contactOrganization: () => undefined }
    );

    expect(plan).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('автор не нашёлся → заметка без автора', () => {
    const plan = planOrganizationNote(
      commentOf({ entity: 'company', entityId: '101', authorId: '3' }),
      ctxOf(),
      { organizationByBitrixId: () => 'org-1', contactOrganization: () => undefined }
    );

    expect(plan).toMatchObject({ action: 'create', data: { authorId: null } });
  });
});

describe('planOrganizationNote — комментарий контакта', () => {
  it('ложится в организацию контакта с префиксом «О контакте …»', () => {
    const plan = planOrganizationNote(
      commentOf({
        id: '608',
        entity: 'contact',
        entityId: '201',
        text: 'Предпочитает переписку в Telegram',
      }),
      ctxOf(),
      {
        organizationByBitrixId: () => undefined,
        contactOrganization: (id) =>
          id === '201' ? { organizationId: 'org-1', name: 'Анна Иванова' } : undefined,
      }
    );

    expect(plan).toEqual({
      action: 'create',
      data: {
        companyId: 'company-1',
        organizationId: 'org-1',
        body: `${contactNotePrefix('Анна Иванова')}Предпочитает переписку в Telegram`,
        authorId: 'user-ivan',
        createdAt: CREATED_AT,
      },
    });
  });

  it('контакт без организации → заметку деть некуда', () => {
    const plan = planOrganizationNote(
      commentOf({ id: '609', entity: 'contact', entityId: '207', authorId: null }),
      ctxOf(),
      {
        organizationByBitrixId: () => undefined,
        contactOrganization: () => ({ organizationId: null, name: 'Без имени' }),
      }
    );

    expect(plan).toEqual({ action: 'skip', reason: 'no_organization' });
  });

  it('контакт вовсе не перенёсся → тот же пропуск', () => {
    const plan = planOrganizationNote(commentOf({ entity: 'contact', entityId: '999' }), ctxOf(), {
      organizationByBitrixId: () => undefined,
      contactOrganization: () => undefined,
    });

    expect(plan).toEqual({ action: 'skip', reason: 'no_organization' });
  });

  it('пустой текст с префиксом всё равно пропускается: префикс — не заметка', () => {
    const plan = planOrganizationNote(
      commentOf({ entity: 'contact', entityId: '201', text: '   ' }),
      ctxOf(),
      {
        organizationByBitrixId: () => undefined,
        contactOrganization: () => ({ organizationId: 'org-1', name: 'Анна Иванова' }),
      }
    );

    expect(plan).toEqual({ action: 'skip', reason: 'empty' });
  });

  it('длинный текст укорачивается ВМЕСТЕ с префиксом — предел считается по целому', () => {
    const prefix = contactNotePrefix('Анна Иванова');
    const plan = planOrganizationNote(
      commentOf({ entity: 'contact', entityId: '201', text: 'я'.repeat(NOTE_BODY_MAX) }),
      ctxOf(),
      {
        organizationByBitrixId: () => undefined,
        contactOrganization: () => ({ organizationId: 'org-1', name: 'Анна Иванова' }),
      }
    );

    expect(plan).toMatchObject({ action: 'create' });
    if (plan.action !== 'create') return;
    expect(plan.data.body.length).toBe(NOTE_BODY_MAX);
    expect(plan.data.body.startsWith(prefix)).toBe(true);
    // Хвост исходного текста обрезан ровно на длину префикса.
    expect(plan.data.body.slice(prefix.length)).toBe('я'.repeat(NOTE_BODY_MAX - prefix.length));
  });
});
