import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { readSource } from './helpers/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-190`, `Р-Б-11`): ключ Битрикса живёт отдельной
 * колонкой `bitrixId` на шести моделях, уникальной — по ней идёт повторный
 * импорт (`У-195`) и откат. Пропавшая колонка или снятая уникальность молча
 * превратили бы повтор пакета в дубли.
 */
// `readSource` снимает комментарии: закомментированная колонка не сойдёт за живую.
const SCHEMA = readSource(path.join(process.cwd(), 'prisma/schema.prisma'));
const MODELS = ['Organization', 'Contact', 'Lead', 'Deal', 'Task', 'Document'] as const;

function modelBody(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(m, `модель ${name} не найдена`).not.toBeNull();
  return m![1]!;
}

describe('Р-Б-11: bitrixId String? @unique на шести моделях', () => {
  it.each(MODELS)('%s', (model) => {
    expect(modelBody(model)).toMatch(/\n\s*bitrixId\s+String\?\s+@unique/);
  });

  it('у DealNote автор необязателен — заметка из Битрикса без автора в ЛК', () => {
    expect(modelBody('DealNote')).toMatch(/\n\s*authorId\s+String\?/);
  });

  it('пакет и журнал записей объявлены', () => {
    expect(SCHEMA).toMatch(/\nmodel BitrixImportBatch \{/);
    expect(SCHEMA).toMatch(/\nmodel BitrixImportWrite \{/);
    expect(modelBody('BitrixImportWrite')).toMatch(/\n\s*after\s+Json\?/);
  });
});
