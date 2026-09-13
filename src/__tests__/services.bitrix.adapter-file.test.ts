import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import {
  FileBitrixSource,
  inspectBitrixFile,
  type BitrixUploadedFile,
} from '@/lib/services/bitrix/adapter-file';
import { FakeBitrixSource } from '@/lib/services/bitrix/adapter-fake';
import type { BitrixFileEntity } from '@/lib/services/bitrix/column-map';
import { FAKE_USERS } from '@/lib/services/bitrix/fixtures/portal';
import { BitrixSourceError, type BitrixStage, type BitrixUser } from '@/lib/services/bitrix/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-189` file, `У-200`): источник из выгрузок
 * Битрикс24. Главный тест — равенство с фикстурой портала: те же пять
 * сущностей, прочитанные из CSV, обязаны дать ровно те же записи, что
 * `fake`-источник. Остальное — краевые пути разбора (XLSX, Windows-1251,
 * разделители, битые файлы) и связи по названию/имени, которых в выгрузке
 * нет как ID.
 */

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

const ALL = {};

const FIXTURE_DIR = path.join(process.cwd(), 'src/__fixtures__/bitrix');
const fixture = (name: string): Buffer => readFileSync(path.join(FIXTURE_DIR, name));

const BOM = '﻿';

type CsvOptions = { bom?: boolean; delimiter?: string };

/** Выгрузка Битрикса: все поля в кавычках, строки через CRLF, по умолчанию UTF-8 с BOM и `;`. */
function csv(rows: string[][], options: CsvOptions = {}): string {
  const { bom = true, delimiter = ';' } = options;
  const body = rows.map((cells) => cells.map((c) => `"${c}"`).join(delimiter)).join('\r\n');
  return `${bom ? BOM : ''}${body}\r\n`;
}

const csvBuffer = (rows: string[][], options: CsvOptions = {}): Buffer =>
  Buffer.from(csv(rows, options), 'utf8');

/** Windows-1251: А..я → 0xC0 + (код − 0x410), ё → 0xB8, Ё → 0xA8, остальное ASCII. */
function cp1251(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x410 && code <= 0x44f) bytes.push(0xc0 + (code - 0x410));
    else if (code === 0x451) bytes.push(0xb8);
    else if (code === 0x401) bytes.push(0xa8);
    else bytes.push(code);
  }
  return Buffer.from(bytes);
}

const upload = (
  entity: BitrixFileEntity,
  fileName: string,
  buffer: Buffer
): BitrixUploadedFile => ({
  entity,
  buffer,
  fileName,
});

async function xlsxBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const sortStages = (list: BitrixStage[]): BitrixStage[] =>
  [...list].sort((a, b) => (`${a.entity}|${a.id}` < `${b.entity}|${b.id}` ? -1 : 1));

const idAndName = (users: BitrixUser[]): Array<{ id: string; name: string }> =>
  [...users].sort((a, b) => (a.id < b.id ? -1 : 1)).map(({ id, name }) => ({ id, name }));

/** Битый XLSX: магия `PK`, дальше мусор — файл «похож на книгу», но не разворачивается. */
const BROKEN_XLSX = Buffer.concat([
  Buffer.from('PK', 'latin1'),
  Buffer.from([3, 4]),
  Buffer.from('мусор вместо архива', 'utf8'),
]);

// ---------------------------------------------------------------------------
// Диагностика файла
// ---------------------------------------------------------------------------

describe('inspectBitrixFile — сущность по шапке выгрузки', () => {
  const cases: Array<[string, BitrixFileEntity, number]> = [
    ['companies.csv', 'company', 5],
    ['contacts.csv', 'contact', 8],
    ['leads.csv', 'lead', 6],
    ['deals.csv', 'deal', 6],
    ['tasks.csv', 'task', 4],
  ];

  it.each(cases)('%s → %s, %i строк, шапка распознана целиком', async (name, entity, rows) => {
    expect(await inspectBitrixFile(fixture(name), name)).toEqual({
      name,
      entity,
      candidate: entity,
      rows,
      unmatchedHeaders: [],
      missing: [],
    });
  });

  it('CSV без BOM в UTF-8 читается так же', async () => {
    const buffer = csvBuffer(
      [
        ['ID', 'Название компании', 'Дата создания'],
        ['501', 'ООО «Без BOM»', '01.05.2026'],
      ],
      { bom: false }
    );
    expect(buffer[0]).not.toBe(0xef);
    expect(await inspectBitrixFile(buffer, 'без-bom.csv')).toMatchObject({
      entity: 'company',
      rows: 1,
      unmatchedHeaders: [],
      missing: [],
    });
  });

  it('CSV в Windows-1251 с запятой-разделителем', async () => {
    const buffer = cp1251(
      csv(
        [
          ['ID', 'Имя', 'Фамилия', 'Телефон', 'Дата создания'],
          ['301', 'Анна', 'Иванова', '+7 921 111-22-33, +7 921 000-00-00', '03.11.2025 09:10:00'],
        ],
        { bom: false, delimiter: ',' }
      )
    );
    // Файл не декодируется как UTF-8 — иначе проверялась бы не та ветка.
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(buffer)).toThrow();
    expect(await inspectBitrixFile(buffer, 'контакты-1251.csv')).toMatchObject({
      entity: 'contact',
      rows: 1,
      unmatchedHeaders: [],
      missing: [],
    });
  });

  it('разделитель — таб (копия из Excel)', async () => {
    const buffer = csvBuffer(
      [
        ['ID', 'Название компании', 'Дата создания'],
        ['601', 'ООО Табуляция', '01.06.2026'],
      ],
      { delimiter: '\t' }
    );
    expect(await inspectBitrixFile(buffer, 'таб.csv')).toMatchObject({
      entity: 'company',
      rows: 1,
    });
  });

  it('книга Excel: шапка и записи берутся с первого непустого листа', async () => {
    const buffer = await xlsxBuffer((wb) => {
      wb.addWorksheet('Пустой лист');
      const ws = wb.addWorksheet('Компании');
      ws.addRow(['ID', 'Название компании', 'Реквизит: ИНН', 'Ответственный', 'Дата создания']);
      ws.addRow([7001, 'ООО «Из книги»', 7701234560, 'Мария Райтова', new Date()]);
    });
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(await inspectBitrixFile(buffer, 'компании.xlsx')).toMatchObject({
      entity: 'company',
      rows: 1,
      unmatchedHeaders: [],
      missing: [],
    });
  });

  it('пустой файл → file_unreadable с подсказкой про шапку', async () => {
    await expect(inspectBitrixFile(Buffer.alloc(0), 'пусто.csv')).rejects.toMatchObject({
      name: 'BitrixSourceError',
      code: 'file_unreadable',
      message: 'Файл «пусто.csv»: пустой файл — нет строки с шапкой',
    });
  });

  it('файл из одних пустых строк → тот же отказ', async () => {
    const buffer = csvBuffer([
      ['', '', ''],
      ['', '', ''],
    ]);
    await expect(inspectBitrixFile(buffer, 'пустые-строки.csv')).rejects.toBeInstanceOf(
      BitrixSourceError
    );
    await expect(inspectBitrixFile(buffer, 'пустые-строки.csv')).rejects.toMatchObject({
      code: 'file_unreadable',
      message: 'Файл «пустые-строки.csv»: пустой файл — нет строки с шапкой',
    });
  });

  it('книга Excel без единой строки → file_unreadable', async () => {
    const buffer = await xlsxBuffer((wb) => {
      wb.addWorksheet('Лист1');
    });
    await expect(inspectBitrixFile(buffer, 'пустая-книга.xlsx')).rejects.toMatchObject({
      code: 'file_unreadable',
      message: 'Файл «пустая-книга.xlsx»: пустой файл — нет строки с шапкой',
    });
  });

  it('битый XLSX → file_unreadable, а не падение разбора', async () => {
    await expect(inspectBitrixFile(BROKEN_XLSX, 'битая.xlsx')).rejects.toMatchObject({
      name: 'BitrixSourceError',
      code: 'file_unreadable',
      message: 'Файл «битая.xlsx»: книга Excel повреждена или это не XLSX',
    });
  });

  it('ломаный CSV → file_unreadable с сообщением разборщика', async () => {
    const buffer = Buffer.from(`${BOM}"ID";"Название компании"\r\n"10"1";"А"\r\n`, 'utf8');
    const error = await inspectBitrixFile(buffer, 'ломаный.csv').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BitrixSourceError);
    expect((error as BitrixSourceError).code).toBe('file_unreadable');
    expect((error as BitrixSourceError).message).toContain('Файл «ломаный.csv»: ');
    expect((error as BitrixSourceError).message).toContain('Parse Error');
  });

  it('разборщик CSV отказал не-ошибкой → «CSV не разобран»', async () => {
    const spy = vi
      .spyOn(ExcelJS.Workbook.prototype, 'csv', 'get')
      .mockReturnValue({ read: () => Promise.reject('поток оборвался') } as never);
    try {
      await expect(inspectBitrixFile(csvBuffer([['ID']]), 'поток.csv')).rejects.toMatchObject({
        code: 'file_unreadable',
        message: 'Файл «поток.csv»: CSV не разобран',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Главный тест: выгрузка = фикстура портала
// ---------------------------------------------------------------------------

describe('FileBitrixSource — пять выгрузок дают ту же картину, что фикстура портала', () => {
  const uploads: BitrixUploadedFile[] = [
    upload('company', 'companies.csv', fixture('companies.csv')),
    upload('contact', 'contacts.csv', fixture('contacts.csv')),
    upload('lead', 'leads.csv', fixture('leads.csv')),
    upload('deal', 'deals.csv', fixture('deals.csv')),
    upload('task', 'tasks.csv', fixture('tasks.csv')),
  ];
  const file = new FileBitrixSource(uploads);
  const fake = new FakeBitrixSource();

  it('check → ok, без URL портала и без имени пользователя', async () => {
    expect(await file.check()).toEqual({
      ok: true,
      portal: 'Файлы выгрузки Битрикс24',
      user: 'файлов: 5',
    });
  });

  it('компании совпадают с фикстурой', async () => {
    expect(await collect(file.companies(ALL))).toEqual(await collect(fake.companies(ALL)));
  });

  it('контакты совпадают с фикстурой', async () => {
    expect(await collect(file.contacts(ALL))).toEqual(await collect(fake.contacts(ALL)));
  });

  it('лиды совпадают с фикстурой', async () => {
    expect(await collect(file.leads(ALL))).toEqual(await collect(fake.leads(ALL)));
  });

  it('сделки совпадают с фикстурой', async () => {
    expect(await collect(file.deals(ALL))).toEqual(await collect(fake.deals(ALL)));
  });

  it('задачи совпадают с фикстурой', async () => {
    expect(await collect(file.tasks(ALL))).toEqual(await collect(fake.tasks(ALL)));
  });

  it('стадии и статусы — то же множество (порядок у файлов свой)', async () => {
    expect(sortStages(await file.stages())).toEqual(sortStages(await fake.stages()));
    expect(await file.stages()).toHaveLength(9);
  });

  it('пользователи: те же ID и имена; почта и «уволен» из выгрузки не видны', async () => {
    const users = await collect(file.users());
    expect(idAndName(users)).toEqual(idAndName(FAKE_USERS));
    expect(users.every((u) => u.email === null)).toBe(true);
    expect(users.every((u) => u.active)).toBe(true);
  });

  it('diagnostics: по записи на файл, все колонки распознаны', async () => {
    expect(await file.diagnostics()).toEqual([
      {
        name: 'companies.csv',
        entity: 'company',
        candidate: 'company',
        rows: 5,
        unmatchedHeaders: [],
        missing: [],
      },
      {
        name: 'contacts.csv',
        entity: 'contact',
        candidate: 'contact',
        rows: 8,
        unmatchedHeaders: [],
        missing: [],
      },
      {
        name: 'leads.csv',
        entity: 'lead',
        candidate: 'lead',
        rows: 6,
        unmatchedHeaders: [],
        missing: [],
      },
      {
        name: 'deals.csv',
        entity: 'deal',
        candidate: 'deal',
        rows: 6,
        unmatchedHeaders: [],
        missing: [],
      },
      {
        name: 'tasks.csv',
        entity: 'task',
        candidate: 'task',
        rows: 4,
        unmatchedHeaders: [],
        missing: [],
      },
    ]);
  });
});

describe('FileBitrixSource — файлы читаются один раз', () => {
  it('второй запрос списка берёт разобранное, буфер повторно не трогается', async () => {
    let reads = 0;
    const counted = { entity: 'company', fileName: 'companies.csv' } as BitrixUploadedFile;
    Object.defineProperty(counted, 'buffer', {
      get(): Buffer {
        reads += 1;
        return fixture('companies.csv');
      },
    });
    const source = new FileBitrixSource([counted]);

    const first = await collect(source.companies(ALL));
    expect(reads).toBe(1);
    const second = await collect(source.companies(ALL));
    expect(second).toEqual(first);
    expect(await source.diagnostics()).toHaveLength(1);
    expect(reads).toBe(1);
  });

  it('две выгрузки одной сущности складываются в один список', async () => {
    const source = new FileBitrixSource([
      upload(
        'company',
        'часть-1.csv',
        csvBuffer([
          ['ID', 'Название компании'],
          ['1', 'Первая'],
        ])
      ),
      upload(
        'company',
        'часть-2.csv',
        csvBuffer([
          ['ID', 'Название компании'],
          ['2', 'Вторая'],
        ])
      ),
    ]);
    expect((await collect(source.companies(ALL))).map((c) => c.title)).toEqual([
      'Первая',
      'Вторая',
    ]);
    expect((await source.diagnostics()).map((d) => d.name)).toEqual(['часть-1.csv', 'часть-2.csv']);
  });

  it('строка без ID пропускается в каждой из пяти сущностей', async () => {
    const source = new FileBitrixSource([
      upload(
        'company',
        'к.csv',
        csvBuffer([
          ['ID', 'Название компании'],
          ['1', 'Компания'],
          ['', 'Итого'],
        ])
      ),
      upload(
        'contact',
        'кт.csv',
        csvBuffer([
          ['ID', 'Имя'],
          ['1', 'Анна'],
          ['', 'Итого'],
        ])
      ),
      upload(
        'lead',
        'л.csv',
        csvBuffer([
          ['ID', 'Название лида', 'Стадия'],
          ['1', 'Лид', 'Новый'],
          ['', 'Итого', ''],
        ])
      ),
      upload(
        'deal',
        'с.csv',
        csvBuffer([
          ['ID', 'Название сделки', 'Стадия сделки'],
          ['1', 'Сделка', 'Новая'],
          ['', 'Итого', ''],
        ])
      ),
      upload(
        'task',
        'з.csv',
        csvBuffer([
          ['ID', 'Название', 'Статус'],
          ['1', 'Задача', 'Новая'],
          ['', 'Итого', ''],
        ])
      ),
    ]);
    expect(await collect(source.companies(ALL))).toHaveLength(1);
    expect(await collect(source.contacts(ALL))).toHaveLength(1);
    expect(await collect(source.leads(ALL))).toHaveLength(1);
    expect(await collect(source.deals(ALL))).toHaveLength(1);
    expect(await collect(source.tasks(ALL))).toHaveLength(1);
    // Строка «Итого» из файла не исчезла — она посчитана в диагностике.
    expect((await source.diagnostics()).map((d) => d.rows)).toEqual([2, 2, 2, 2, 2]);
  });
});

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

describe('FileBitrixSource — книга Excel', () => {
  const created = new Date(Date.UTC(2026, 3, 1, 10, 0, 0));

  async function book(): Promise<Buffer> {
    return xlsxBuffer((wb) => {
      wb.addWorksheet('Пустой лист');
      const ws = wb.addWorksheet('Компании');
      ws.addRow([
        'ID',
        'Название компании',
        'Реквизит: ИНН',
        'Ответственный',
        'Дата создания',
        'Комментарий',
      ]);
      ws.addRow([
        7001,
        { richText: [{ text: 'ООО ' }, { text: '«Рич Текст»' }] },
        7701234560,
        'Мария Райтова',
        created,
        null,
      ]);
      ws.addRow([]);
      ws.addRow([7002, 'ООО «Второе»', null, 'Мария Райтова', null, 'без ИНН']);
    });
  }

  it('числа становятся строками, rich text склеивается, дата остаётся датой', async () => {
    const source = new FileBitrixSource([upload('company', 'книга.xlsx', await book())]);
    expect(await collect(source.companies(ALL))).toEqual([
      {
        id: '7001',
        title: 'ООО «Рич Текст»',
        inn: '7701234560',
        kpp: null,
        assignedById: 'name:мария райтова',
        createdAt: created,
        comments: null,
      },
      {
        id: '7002',
        title: 'ООО «Второе»',
        inn: null,
        kpp: null,
        assignedById: 'name:мария райтова',
        createdAt: null,
        comments: 'без ИНН',
      },
    ]);
  });

  it('без колонки «ID ответственного» пользователь заводится по имени, один раз', async () => {
    const source = new FileBitrixSource([upload('company', 'книга.xlsx', await book())]);
    expect(await collect(source.users())).toEqual([
      { id: 'name:мария райтова', email: null, name: 'Мария Райтова', active: true },
    ]);
  });

  it('пустая строка книги в записи не превращается', async () => {
    const source = new FileBitrixSource([upload('company', 'книга.xlsx', await book())]);
    expect(await source.diagnostics()).toEqual([
      {
        name: 'книга.xlsx',
        entity: 'company',
        candidate: 'company',
        rows: 2,
        unmatchedHeaders: [],
        missing: [],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Связи по названию и имени
// ---------------------------------------------------------------------------

describe('FileBitrixSource — связи, которых в выгрузке нет как ID', () => {
  const companies = upload(
    'company',
    'компании.csv',
    csvBuffer([
      ['ID', 'Название компании'],
      ['101', 'ООО «Альфа Строй»'],
      ['102', 'Вектор Плюс, ООО'],
      ['103', 'ООО «Альфа Строй»'],
      ['104', 'Зелёный Дом'],
    ])
  );
  // Без колонки «ID компании» и без телефонов/почт — связь только по названию.
  const contacts = upload(
    'contact',
    'контакты.csv',
    csvBuffer([
      ['ID', 'Имя', 'Фамилия', 'Компания'],
      ['201', 'Анна', 'Иванова', 'ООО  «АЛЬФА  СТРОЙ»'],
      ['202', 'Мария', '', 'Неизвестная фирма'],
      ['203', 'Пётр', '', 'Вектор Плюс, ООО'],
      ['204', 'Глеб', 'Кузнецов', 'Зеленый Дом'],
    ])
  );

  it('компания контакта находится по названию: регистр, «ё» и лишние пробелы не мешают', async () => {
    const source = new FileBitrixSource([companies, contacts]);
    const rows = await collect(source.contacts(ALL));
    expect(rows.map((c) => [c.id, c.companyId])).toEqual([
      ['201', '101'],
      ['202', null],
      ['203', '102'],
      ['204', '104'],
    ]);
    // Название-дубль (103) не перебивает первую компанию с таким же названием.
    expect(rows[0]?.companyId).toBe('101');
    // Колонок телефонов и почт в файле нет — списки пустые, а не «undefined».
    expect(rows.map((c) => [c.phones, c.emails])).toEqual([
      [[], []],
      [[], []],
      [[], []],
      [[], []],
    ]);
  });

  it('без файла компаний связь по названию давать нечего — null', async () => {
    const source = new FileBitrixSource([contacts]);
    expect((await collect(source.contacts(ALL))).every((c) => c.companyId === null)).toBe(true);
  });

  it('контакт сделки ищется и по «Фамилия Имя», а колонка с ID главнее имени', async () => {
    const deals = upload(
      'deal',
      'сделки.csv',
      csvBuffer([
        ['ID', 'Название сделки', 'Стадия сделки', 'Контакт', 'ID контакта'],
        ['401', 'По фамилии и имени', 'В работе', 'Иванова Анна', ''],
        ['402', 'ID важнее имени', 'В работе', 'Иванова Анна', '999'],
        ['403', 'Никого такого нет', 'В работе', 'Кто-то Другой', ''],
        ['404', 'Контакт не указан', 'В работе', '', ''],
      ])
    );
    const source = new FileBitrixSource([companies, contacts, deals]);
    expect((await collect(source.deals(ALL))).map((d) => [d.id, d.contactId, d.companyId])).toEqual(
      [
        ['401', '201', null],
        ['402', '999', null],
        ['403', null, null],
        ['404', null, null],
      ]
    );
  });
});

// ---------------------------------------------------------------------------
// Стадии, направления и закрытость
// ---------------------------------------------------------------------------

describe('FileBitrixSource — стадии сделок и статусы лидов', () => {
  it('без колонок «ID стадии» и «Сделка закрыта» стадией становится её название', async () => {
    const source = new FileBitrixSource([
      upload(
        'deal',
        'сделки.csv',
        csvBuffer([
          ['ID', 'Название сделки', 'Стадия сделки'],
          ['701', 'Успех', 'Сделка успешна'],
          ['702', 'Провал', 'Сделка провалена'],
          ['703', 'Идёт', 'В работе'],
          ['704', 'Разбор', 'Анализ причины провала'],
          ['705', 'Стадия не выгрузилась', ''],
        ])
      ),
    ]);
    expect((await collect(source.deals(ALL))).map((d) => [d.id, d.stageId, d.closed])).toEqual([
      ['701', 'Сделка успешна', true],
      ['702', 'Сделка провалена', true],
      ['703', 'В работе', false],
      ['704', 'Анализ причины провала', true],
      ['705', '', false],
    ]);
    expect(await source.stages()).toEqual([
      {
        entity: 'deal',
        categoryId: null,
        id: 'Сделка успешна',
        name: 'Сделка успешна',
        semantics: 'success',
      },
      {
        entity: 'deal',
        categoryId: null,
        id: 'Сделка провалена',
        name: 'Сделка провалена',
        semantics: 'failure',
      },
      {
        entity: 'deal',
        categoryId: null,
        id: 'В работе',
        name: 'В работе',
        semantics: 'process',
      },
      {
        entity: 'deal',
        categoryId: null,
        id: 'Анализ причины провала',
        name: 'Анализ причины провала',
        semantics: 'apology',
      },
    ]);
  });

  it('«C3:WON» в направлении 3: семантика по хвосту ID, стадия регистрируется один раз', async () => {
    const source = new FileBitrixSource([
      upload(
        'deal',
        'сделки.csv',
        csvBuffer([
          ['ID', 'Название сделки', 'ID направления', 'ID стадии', 'Стадия сделки'],
          ['801', 'Своя воронка', '3', 'C3:WON', 'Сделка успешна'],
          ['802', 'Та же стадия', '3', 'C3:WON', 'Сделка успешна'],
          ['803', 'Общее направление', '0', 'NEW', 'Новая'],
        ])
      ),
    ]);
    expect((await collect(source.deals(ALL))).map((d) => [d.id, d.categoryId, d.closed])).toEqual([
      ['801', '3', true],
      ['802', '3', true],
      ['803', '0', false],
    ]);
    expect(await source.stages()).toEqual([
      {
        entity: 'deal',
        categoryId: '3',
        id: 'C3:WON',
        name: 'Сделка успешна',
        semantics: 'success',
      },
      { entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая', semantics: 'process' },
    ]);
  });

  it('нет колонки направления → «0» у сделки и null у стадии; имя стадии = её ID', async () => {
    const source = new FileBitrixSource([
      upload(
        'deal',
        'сделки.csv',
        csvBuffer([
          ['ID', 'Название сделки', 'ID стадии'],
          ['901', 'Без направления', 'WON'],
        ])
      ),
    ]);
    const [deal] = await collect(source.deals(ALL));
    expect(deal).toMatchObject({ categoryId: '0', stageId: 'WON', closed: true });
    expect(await source.stages()).toEqual([
      { entity: 'deal', categoryId: null, id: 'WON', name: 'WON', semantics: 'success' },
    ]);
  });

  it('колонка «Сделка закрыта» главнее семантики стадии', async () => {
    const source = new FileBitrixSource([
      upload(
        'deal',
        'сделки.csv',
        csvBuffer([
          ['ID', 'Название сделки', 'ID стадии', 'Сделка закрыта'],
          ['902', 'Успешна, но не закрыта', 'WON', 'Нет'],
          ['903', 'В работе, но закрыта', 'EXECUTING', 'Да'],
        ])
      ),
    ]);
    expect((await collect(source.deals(ALL))).map((d) => [d.id, d.closed])).toEqual([
      ['902', false],
      ['903', true],
    ]);
  });

  it('статус лида без колонки ID: название становится и ID, и именем', async () => {
    const source = new FileBitrixSource([
      upload(
        'lead',
        'лиды.csv',
        csvBuffer([
          ['ID', 'Название лида', 'Стадия'],
          ['950', 'Мусорный', 'Некачественный лид'],
          ['951', 'Довели до сделки', 'Качественный лид'],
          ['952', 'Статус не выгрузился', ''],
        ])
      ),
    ]);
    expect((await collect(source.leads(ALL))).map((l) => [l.id, l.statusId])).toEqual([
      ['950', 'Некачественный лид'],
      ['951', 'Качественный лид'],
      ['952', ''],
    ]);
    expect(await source.stages()).toEqual([
      {
        entity: 'lead',
        categoryId: null,
        id: 'Некачественный лид',
        name: 'Некачественный лид',
        semantics: 'failure',
      },
      {
        entity: 'lead',
        categoryId: null,
        id: 'Качественный лид',
        name: 'Качественный лид',
        semantics: 'success',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Задачи
// ---------------------------------------------------------------------------

describe('FileBitrixSource — задачи', () => {
  const tasks = upload(
    'task',
    'задачи.csv',
    csvBuffer([
      ['ID', 'Название', 'Статус', 'Ответственный', 'Постановщик', 'CRM'],
      ['601', 'Ждёт', 'Ждет выполнения', 'Анна Иванова', 'Борис Петров', 'CO_101, D_401'],
      ['602', 'Идёт', 'Выполняется', 'Анна Иванова', 'Борис Петров', ''],
      ['603', 'На контроле', 'Ждет контроля', '', '', ''],
      ['604', 'Готова', 'Завершена', '', '', ''],
      ['605', 'Отложена', 'Отложена', '', '', ''],
      ['606', 'Код 3', '3', '', '', ''],
      ['607', 'Код 4', '4', '', '', ''],
      ['608', 'Код 5', '5', '', '', ''],
      ['609', 'Код 6', '6', '', '', ''],
      ['610', 'Чужой статус', 'Марсианская стадия', '', '', ''],
    ])
  );

  it('статус — по названию колонки или по коду; незнакомое → «ждёт выполнения»', async () => {
    const source = new FileBitrixSource([tasks]);
    expect((await collect(source.tasks(ALL))).map((t) => t.status)).toEqual([
      2, 3, 4, 5, 6, 3, 4, 5, 6, 2,
    ]);
  });

  it('колонка CRM разбирается в привязки, чужие токены пропускаются', async () => {
    const source = new FileBitrixSource([tasks]);
    const rows = await collect(source.tasks(ALL));
    expect(rows[0]?.crmLinks).toEqual([
      { kind: 'company', id: '101' },
      { kind: 'deal', id: '401' },
    ]);
    expect(rows[1]?.crmLinks).toEqual([]);
  });

  it('постановщик и ответственный без ID — по одному пользователю на имя', async () => {
    const source = new FileBitrixSource([tasks]);
    const rows = await collect(source.tasks(ALL));
    expect(rows[0]).toMatchObject({
      responsibleId: 'name:анна иванова',
      createdById: 'name:борис петров',
    });
    expect(rows[2]).toMatchObject({ responsibleId: null, createdById: null });
    expect(await collect(source.users())).toEqual([
      { id: 'name:анна иванова', email: null, name: 'Анна Иванова', active: true },
      { id: 'name:борис петров', email: null, name: 'Борис Петров', active: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Пользователи
// ---------------------------------------------------------------------------

describe('FileBitrixSource — книга пользователей', () => {
  it('сначала один ID без имени, потом ID с именем — имя дописывается', async () => {
    const source = new FileBitrixSource([
      upload(
        'company',
        'компании.csv',
        csvBuffer([
          ['ID', 'Название компании', 'ID ответственного', 'Ответственный'],
          ['1', 'Без имени ответственного', '7', ''],
          ['2', 'С именем', '7', 'Семён Семёнов'],
          ['3', 'Имя уже известно', '7', 'Кто-то ещё'],
          ['4', 'Никого', '', ''],
        ])
      ),
    ]);
    expect(await collect(source.users())).toEqual([
      { id: '7', email: null, name: 'Семён Семёнов', active: true },
    ]);
    expect((await collect(source.companies(ALL))).map((c) => c.assignedById)).toEqual([
      '7',
      '7',
      '7',
      null,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Фильтры
// ---------------------------------------------------------------------------

describe('FileBitrixSource — фильтры периода и «только открытые»', () => {
  const source = new FileBitrixSource([
    upload('company', 'companies.csv', fixture('companies.csv')),
    upload('contact', 'contacts.csv', fixture('contacts.csv')),
    upload('lead', 'leads.csv', fixture('leads.csv')),
    upload('deal', 'deals.csv', fixture('deals.csv')),
    upload('task', 'tasks.csv', fixture('tasks.csv')),
  ]);

  it('from отсекает созданное раньше', async () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect((await collect(source.companies({ from }))).map((c) => c.id)).toEqual([
      '103',
      '104',
      '105',
    ]);
    expect((await collect(source.contacts({ from }))).map((c) => c.id)).toEqual([
      '205',
      '206',
      '207',
      '208',
    ]);
    expect((await collect(source.leads({ from }))).map((l) => l.id)).toEqual([
      '302',
      '303',
      '304',
      '305',
      '306',
    ]);
    expect((await collect(source.tasks({ from }))).map((t) => t.id)).toEqual(['502', '503', '504']);
  });

  it('to отсекает созданное позже, окно from+to работает вместе', async () => {
    expect(
      (await collect(source.companies({ to: new Date('2025-12-31T23:59:59Z') }))).map((c) => c.id)
    ).toEqual(['101', '102']);
    expect(
      (
        await collect(
          source.deals({
            from: new Date('2025-12-01T00:00:00Z'),
            to: new Date('2026-02-01T00:00:00Z'),
          })
        )
      ).map((d) => d.id)
    ).toEqual(['403']);
  });

  it('openOnly: только незакрытые сделки и незавершённые задачи', async () => {
    expect((await collect(source.deals({ openOnly: true }))).map((d) => d.id)).toEqual([
      '402',
      '405',
      '406',
    ]);
    const tasks = await collect(source.tasks({ openOnly: true }));
    expect(tasks.map((t) => t.id)).toEqual(['502', '503', '504']);
    expect(tasks.every((t) => t.status !== 5)).toBe(true);
  });

  it('запись без даты создания проходит любой фильтр', async () => {
    const undated = new FileBitrixSource([
      upload(
        'company',
        'без-даты.csv',
        csvBuffer([
          ['ID', 'Название компании', 'Дата создания'],
          ['1', 'Без даты', ''],
          ['2', 'С датой', '01.01.2020'],
        ])
      ),
    ]);
    const strict = { from: new Date('2099-01-01T00:00:00Z'), to: new Date('2099-01-02T00:00:00Z') };
    expect((await collect(undated.companies(strict))).map((c) => c.id)).toEqual(['1']);
  });
});

// ---------------------------------------------------------------------------
// Чего в выгрузке нет
// ---------------------------------------------------------------------------

describe('FileBitrixSource — чего выгрузка не даёт', () => {
  const source = new FileBitrixSource([
    upload('company', 'companies.csv', fixture('companies.csv')),
  ]);

  it('таймлайна и вложений нет: comments и files пусты', async () => {
    expect(await collect(source.comments())).toEqual([]);
    expect(await collect(source.files())).toEqual([]);
  });

  it('download → source_no_files с именем файла', async () => {
    const file = {
      id: '701',
      entity: 'deal' as const,
      entityId: '401',
      name: 'договор.pdf',
      size: 1024,
      downloadUrl: null,
    };
    await expect(source.download(file)).rejects.toBeInstanceOf(BitrixSourceError);
    await expect(source.download(file)).rejects.toMatchObject({
      code: 'source_no_files',
      message: 'Файловый источник не отдаёт вложения («договор.pdf»)',
    });
  });

  it('check без файлов → отказ с объяснением', async () => {
    expect(await new FileBitrixSource([]).check()).toEqual({
      ok: false,
      message: 'Не загружено ни одного файла выгрузки',
    });
  });

  it('check с битым файлом → отказ с именем файла в сообщении', async () => {
    const broken = new FileBitrixSource([
      upload('company', 'сломанная-выгрузка.xlsx', BROKEN_XLSX),
    ]);
    expect(await broken.check()).toEqual({
      ok: false,
      message: 'Файл «сломанная-выгрузка.xlsx»: книга Excel повреждена или это не XLSX',
    });
  });

  it('check не падает, даже если файл бросил не-ошибку', async () => {
    const evil = { entity: 'company', fileName: 'обрыв.csv' } as BitrixUploadedFile;
    Object.defineProperty(evil, 'buffer', {
      get(): Buffer {
        // Намеренно не Error: так ведут себя чужие сбои чтения потока.
        throw 'поток файла оборвался';
      },
    });
    expect(await new FileBitrixSource([evil]).check()).toEqual({
      ok: false,
      message: 'поток файла оборвался',
    });
  });
});

describe('счётчик строк диагностики', () => {
  it('строки без ID не считаются: форма обещает ровно столько, сколько перенесётся', async () => {
    const buffer = csvBuffer([
      ['ID', 'Название компании'],
      ['101', 'ООО «Альфа Строй»'],
      ['', 'Итого'],
      ['102', 'АО «Бета Логистик»'],
    ]);
    const d = await inspectBitrixFile(buffer, 'компании.csv');
    expect(d.entity).toBe('company');
    expect(d.rows).toBe(2);

    const source = new FileBitrixSource([{ entity: 'company', buffer, fileName: 'компании.csv' }]);
    expect(await collect(source.companies(ALL))).toHaveLength(d.rows);
  });

  it('шапка не распознана — считаем все строки: колонку ID искать не в чем', async () => {
    const d = await inspectBitrixFile(
      csvBuffer([
        ['Фу', 'Бар'],
        ['1', '2'],
        ['3', '4'],
      ]),
      'непонятное.csv'
    );
    expect(d).toMatchObject({
      entity: null,
      candidate: null,
      rows: 2,
      unmatchedHeaders: ['Фу', 'Бар'],
      missing: [],
    });
  });
});
