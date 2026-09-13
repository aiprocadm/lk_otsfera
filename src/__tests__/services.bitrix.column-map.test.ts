import { describe, expect, it } from 'vitest';

import {
  BITRIX_ENTITY_LABELS,
  BITRIX_FILE_ENTITIES,
  detectEntityByHeaders,
  resolveBitrixColumns,
} from '@/lib/services/bitrix/column-map';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-189` file): шапка выгрузки Битрикс24 → поля
 * источника. Сами карты колонок (`BITRIX_COLS`, `REQUIRED_BITRIX_COLS`)
 * наружу не экспортируются — их поведение проверяется через две функции.
 *
 * Шапки ниже списаны с фикстур `src/__fixtures__/bitrix/*.csv` (UTF-8 c BOM,
 * разделитель «;», значения в кавычках) — это настоящие названия колонок
 * «Экспорта в CSV» русского портала.
 */

const COMPANY_HEADERS = [
  'ID',
  'Название компании',
  'Реквизит: ИНН',
  'Реквизит: КПП',
  'ID ответственного',
  'Ответственный',
  'Дата создания',
  'Комментарий',
];

const CONTACT_HEADERS = [
  'ID',
  'Имя',
  'Фамилия',
  'Должность',
  'ID компании',
  'Компания',
  'Рабочий телефон',
  'Мобильный телефон',
  'Рабочий e-mail',
  'ID ответственного',
  'Ответственный',
  'Дата создания',
];

const LEAD_HEADERS = [
  'ID',
  'Название лида',
  'Имя',
  'Фамилия',
  'Название компании',
  'Телефон',
  'E-mail',
  'ИНН',
  'ID стадии',
  'Стадия',
  'ID ответственного',
  'Ответственный',
  'Сумма',
  'Дата создания',
  'Комментарий',
];

const DEAL_HEADERS = [
  'ID',
  'Название сделки',
  'ID направления',
  'Направление',
  'ID стадии',
  'Стадия сделки',
  'Сумма',
  'ID компании',
  'Компания',
  'ID контакта',
  'Контакт',
  'ID лида',
  'ID ответственного',
  'Ответственный',
  'Дата создания',
  'Дата закрытия',
  'Сделка закрыта',
  'Комментарий',
];

const TASK_HEADERS = [
  'ID',
  'Название',
  'Описание',
  'Статус',
  'ID ответственного',
  'Ответственный',
  'ID постановщика',
  'Постановщик',
  'Крайний срок',
  'Дата создания',
  'Дата завершения',
  'CRM',
];

describe('BITRIX_FILE_ENTITIES и BITRIX_ENTITY_LABELS', () => {
  it('пять сущностей выгрузки в порядке разбора', () => {
    expect(BITRIX_FILE_ENTITIES).toEqual(['company', 'contact', 'lead', 'deal', 'task']);
  });

  it('у каждой сущности есть русское название для формы и отчёта', () => {
    expect(BITRIX_ENTITY_LABELS).toEqual({
      company: 'Компании',
      contact: 'Контакты',
      lead: 'Лиды',
      deal: 'Сделки',
      task: 'Задачи',
    });
    // Глоссарий: «Компании Битрикс24» — это организации ЛК; название не пустое ни у одной.
    for (const entity of BITRIX_FILE_ENTITIES) {
      expect(BITRIX_ENTITY_LABELS[entity].length).toBeGreaterThan(0);
    }
  });
});

describe('resolveBitrixColumns — шапка файла → поля сущности', () => {
  it('настоящая шапка компаний раскладывается по полям целиком', () => {
    expect(resolveBitrixColumns('company', COMPANY_HEADERS)).toEqual({
      index: {
        id: [0],
        title: [1],
        inn: [2],
        kpp: [3],
        assignedById: [4],
        assignedByName: [5],
        createdAt: [6],
        comments: [7],
      },
      unmatched: [],
      missing: [],
    });
  });

  it('настоящая шапка задач раскладывается по полям целиком (включая колонку CRM)', () => {
    const { index, unmatched, missing } = resolveBitrixColumns('task', TASK_HEADERS);
    expect(index).toEqual({
      id: [0],
      title: [1],
      description: [2],
      status: [3],
      responsibleId: [4],
      responsibleName: [5],
      createdById: [6],
      createdByName: [7],
      deadline: [8],
      createdAt: [9],
      closedAt: [10],
      crm: [11],
    });
    expect(unmatched).toEqual([]);
    expect(missing).toEqual([]);
  });

  describe('нормализация заголовка перед сравнением', () => {
    it('регистр не важен', () => {
      expect(resolveBitrixColumns('company', ['ID', 'НАЗВАНИЕ КОМПАНИИ']).index).toEqual({
        id: [0],
        title: [1],
      });
      expect(resolveBitrixColumns('company', ['id', 'название компании']).index).toEqual({
        id: [0],
        title: [1],
      });
    });

    it('лишние и двойные пробелы схлопываются, по краям обрезаются', () => {
      expect(
        resolveBitrixColumns('company', ['  ID  ', 'Название   компании', ' Реквизит:  ИНН ']).index
      ).toEqual({ id: [0], title: [1], inn: [2] });
    });

    it('неразрывный пробел U+00A0 внутри заголовка не мешает', () => {
      // Выгрузка Битрикса приносит NBSP вместо обычного пробела — глазом не отличить.
      expect(resolveBitrixColumns('company', ['Дата создания']).index).toEqual({
        createdAt: [0],
      });
    });

    it('перенос строки внутри заголовка тоже схлопывается в пробел', () => {
      expect(resolveBitrixColumns('company', ['Название\nкомпании']).index).toEqual({ title: [0] });
    });

    it('«ё» в заголовке приравнивается к «е» (все алиасы записаны через «е»)', () => {
      // В самих алиасах «ё» нет ни разу, поэтому правило видно только с этой стороны:
      // как бы портал ни написал букву, колонка обязана найтись.
      expect(resolveBitrixColumns('company', ['Отвётственный']).index).toEqual({
        assignedByName: [0],
      });
    });
  });

  it('поля-множества собирают ВСЕ совпавшие колонки, обычные — только первую', () => {
    const { index, unmatched } = resolveBitrixColumns('contact', CONTACT_HEADERS);
    // «Рабочий телефон» + «Мобильный телефон» — два индекса в одном поле phones.
    expect(index.phones).toEqual([6, 7]);
    expect(index.emails).toEqual([8]);
    expect(index.id).toEqual([0]);
    expect(unmatched).toEqual([]);
  });

  it('четыре телефонные колонки подряд дают четыре индекса', () => {
    const { index } = resolveBitrixColumns('contact', [
      'Рабочий телефон',
      'Мобильный телефон',
      'Домашний телефон',
      'Другой телефон',
    ]);
    expect(index.phones).toEqual([0, 1, 2, 3]);
  });

  it('повтор обычной колонки: берётся первая, вторая НЕ считается чужой', () => {
    // «Название» — тоже алиас title. Вторая такая колонка не должна попасть
    // в unmatched: иначе диагностика соврёт «колонка не распознана».
    const { index, unmatched } = resolveBitrixColumns('company', [
      'ID',
      'Название компании',
      'Название',
    ]);
    expect(index.title).toEqual([1]);
    expect(unmatched).toEqual([]);
  });

  it('заголовок-объект (rich text из exceljs) читается так же, как строка', () => {
    const { index, unmatched } = resolveBitrixColumns('company', [
      { richText: [{ text: 'Название ' }, { text: 'компании' }] },
      { text: 'Реквизит: ИНН' },
    ]);
    expect(index).toEqual({ title: [0], inn: [1] });
    expect(unmatched).toEqual([]);
  });

  it('пустой заголовок пропускается — он не поле и не «не распознан»', () => {
    const { index, unmatched } = resolveBitrixColumns('company', [
      'ID',
      '',
      '   ',
      null,
      undefined,
      'Название компании',
    ]);
    expect(index).toEqual({ id: [0], title: [5] });
    expect(unmatched).toEqual([]);
  });

  it('незнакомые колонки попадают в unmatched исходным написанием', () => {
    const { index, unmatched } = resolveBitrixColumns('company', [
      'ID',
      '  Источник  ',
      'UTM-метка',
    ]);
    expect(index).toEqual({ id: [0] });
    expect(unmatched).toEqual(['Источник', 'UTM-метка']);
  });

  describe('missing — обязательные колонки, которых нет', () => {
    it('называется ПЕРВЫЙ алиас первого поля группы', () => {
      expect(resolveBitrixColumns('company', []).missing).toEqual(['ID', 'Название компании']);
      expect(resolveBitrixColumns('contact', ['ID']).missing).toEqual(['Имя']);
      expect(resolveBitrixColumns('task', ['ID']).missing).toEqual(['Название', 'Статус']);
    });

    it('у сделки без стадии подсказка говорит «Стадия сделки», у лида — «Стадия»', () => {
      expect(resolveBitrixColumns('deal', ['ID', 'Название сделки']).missing).toEqual([
        'Стадия сделки',
      ]);
      expect(resolveBitrixColumns('lead', ['ID', 'Название лида']).missing).toEqual(['Стадия']);
    });

    it('группа «хотя бы одна из» закрывается любым полем группы', () => {
      // Стадия сделки может прийти названием ИЛИ идентификатором — хватит одного.
      expect(resolveBitrixColumns('deal', ['ID', 'Название сделки', 'ID стадии']).missing).toEqual(
        []
      );
      // Контакту хватает одной «Фамилии» — имя не обязательно.
      expect(resolveBitrixColumns('contact', ['ID', 'Фамилия']).missing).toEqual([]);
    });
  });
});

describe('detectEntityByHeaders — что за файл нам дали', () => {
  it('узнаёт каждую из пяти сущностей по её настоящей шапке', () => {
    expect(detectEntityByHeaders(COMPANY_HEADERS)).toEqual({
      entity: 'company',
      candidate: 'company',
      unmatched: [],
      missing: [],
    });
    expect(detectEntityByHeaders(CONTACT_HEADERS).entity).toBe('contact');
    expect(detectEntityByHeaders(LEAD_HEADERS).entity).toBe('lead');
    expect(detectEntityByHeaders(DEAL_HEADERS).entity).toBe('deal');
    expect(detectEntityByHeaders(TASK_HEADERS).entity).toBe('task');
  });

  it('шапка лидов подходит и контактам, но у лида больше распознанных колонок', () => {
    // Проверка «побеждает тот, у кого больше совпадений»: контакту этой шапки
    // тоже хватает обязательных колонок (ID + Имя), но совпадений меньше.
    expect(detectEntityByHeaders(LEAD_HEADERS)).toEqual({
      entity: 'lead',
      candidate: 'lead',
      unmatched: [],
      missing: [],
    });
    expect(resolveBitrixColumns('contact', LEAD_HEADERS).missing).toEqual([]);
  });

  it('коротенькая шапка ID + Название — это компании', () => {
    // Только у компании «Название» закрывает обязательную колонку без стадии/статуса.
    expect(detectEntityByHeaders(['ID', 'Название'])).toEqual({
      entity: 'company',
      candidate: 'company',
      unmatched: [],
      missing: [],
    });
  });

  it('похоже на сделки, но без стадии — отказ с подсказкой, чего не хватило', () => {
    expect(detectEntityByHeaders(['ID', 'Название сделки', 'Сумма'])).toEqual({
      entity: null,
      candidate: 'deal',
      unmatched: [],
      missing: ['Стадия сделки'],
    });
  });

  it('ничья двух подходящих сущностей → отказ, решает человек', () => {
    // «Стадия» — алиас и у лида (statusName), и у сделки (stageName); у обоих
    // «ID» и «Название» закрывают обязательные колонки, счёт 3:3 — победителя нет.
    // Кандидатом называется лид: при равном счёте выигрывает тот, кто раньше
    // в BITRIX_FILE_ENTITIES.
    expect(detectEntityByHeaders(['ID', 'Название', 'Стадия'])).toEqual({
      entity: null,
      candidate: 'lead',
      unmatched: [],
      missing: [],
    });
  });

  it('чужой файл — ни одна колонка не узнана: без сущности и без кандидата', () => {
    expect(detectEntityByHeaders(['Фу', 'Бар'])).toEqual({
      entity: null,
      candidate: null,
      unmatched: ['Фу', 'Бар'],
      missing: [],
    });
  });

  it('пустые заголовки чужого файла в список «не распознано» не попадают', () => {
    expect(detectEntityByHeaders(['Фу', '', null, '  '])).toEqual({
      entity: null,
      candidate: null,
      unmatched: ['Фу'],
      missing: [],
    });
  });

  it('шапка компаний с лишней колонкой: сущность найдена, лишнее — в предупреждении', () => {
    const detection = detectEntityByHeaders([...COMPANY_HEADERS, 'UTM-метка']);
    expect(detection.entity).toBe('company');
    expect(detection.unmatched).toEqual(['UTM-метка']);
  });
});
