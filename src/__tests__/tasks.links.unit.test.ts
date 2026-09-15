import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { taskLinkField, taskLinkValue, type TaskLinkRef } from '@/lib/tasks/links';

/**
 * Справочник «откуда заводится задача» (`У-220`, этап 4 PR-2).
 *
 * До него «какое поле считать связью» знали три места: сервис, server-action и
 * панель на карточке — и каждое знало про свои два вида. Здесь проверяется, что
 * справочник остался ЕДИНСТВЕННЫМ источником: имя поля формы обязано совпадать
 * с именем колонки `Task`, иначе форма пошлёт одно, а выборка спросит другое —
 * и блок «Задачи» будет вечно пустым, ничего при этом не ломая.
 */

const CASES: Array<[TaskLinkRef, string, string]> = [
  [{ orderId: 'o1' }, 'linkedOrderId', 'o1'],
  [{ organizationId: 'org1' }, 'linkedOrganizationId', 'org1'],
  [{ leadId: 'l1' }, 'linkedLeadId', 'l1'],
  [{ dealId: 'd1' }, 'linkedDealId', 'd1'],
  [{ contactId: 'k1' }, 'linkedContactId', 'k1'],
  [{ dialogId: 'dlg1' }, 'linkedDialogId', 'dlg1'],
  [{ documentId: 'doc1' }, 'linkedDocumentId', 'doc1'],
];

describe('taskLinkField / taskLinkValue', () => {
  it.each(CASES)('%o → поле %s, значение %s', (link, field, value) => {
    expect(taskLinkField(link)).toBe(field);
    expect(taskLinkValue(link)).toBe(value);
  });

  it('семь видов связи — ни одного лишнего и ни одного пропущенного', () => {
    const fields = CASES.map(([link]) => taskLinkField(link));
    expect(new Set(fields).size).toBe(7);
  });

  it('КАЖДОЕ поле справочника реально есть в модели Task', () => {
    // Опечатка в имени поля не уронила бы ни один экран: форма отправила бы
    // «linkedDokumentId», сервис спросил бы «linkedDocumentId», и блок «Задачи»
    // молча остался бы пустым. Поэтому сверяемся со схемой.
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const task = schema.slice(schema.indexOf('model Task {'));
    const body = task.slice(0, task.indexOf('\n}'));
    for (const [link] of CASES) {
      expect(body, `в модели Task нет поля ${taskLinkField(link)}`).toContain(taskLinkField(link));
    }
  });

  it('server-action читает из формы ровно эти ключи', () => {
    // Второй таблицы соответствий нет и не должно быть: `taskInput` разбирает
    // форму по тем же именам. Если ключ разъедется, связь потеряется по дороге.
    const action = readFileSync(
      join(process.cwd(), 'src/server-actions/tasks/index.ts'),
      'utf8'
    );
    for (const [link] of CASES) {
      expect(action, `taskInput не читает ${taskLinkField(link)}`).toContain(
        `str(fd, '${taskLinkField(link)}')`
      );
    }
  });
});
