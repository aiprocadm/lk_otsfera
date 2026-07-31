// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { InnDuplicateHint } from '@/components/party/inn-duplicate-hint';

/**
 * Этап 5 PR-2 (ФТ-13.4): информационная плашка антидублей по ИНН для
 * staff-форм. Fake timers (debounce 400мс) + fetch-шпион:
 *  - не-ИНН (9 цифр) не фетчит; 10/12 цифр (в т.ч. с пробелами/дефисами)
 *    фетчит нормализованный ИНН после 400мс;
 *  - плашка: организации-ссылки cardHrefBase/id + лиды с русскими статусами;
 *  - excludeOrganizationId прячет саму редактируемую организацию;
 *  - пустые дубли / 403 / 429 / сетевая ошибка → молча ничего;
 *  - смена ИНН гасит устаревшую плашку сразу.
 */

const DUPLICATES = {
  organizations: [
    { id: 'o1', name: 'ООО Ромашка' },
    { id: 'o2', name: 'ООО Василёк' },
  ],
  leads: [
    { id: 'l1', subject: 'Обучение ОТ', status: 'new' },
    { id: 'l2', subject: 'Повторное обучение', status: 'in_review' },
  ],
};

function okJson(body: unknown) {
  return { ok: true, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(okJson({ duplicates: DUPLICATES }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('InnDuplicateHint — когда фетчим', () => {
  it('9 цифр (не ИНН) → fetch не зовётся, плашки нет', async () => {
    render(<InnDuplicateHint inn="123456789" cardHrefBase="/manager/organizations" />);
    await settle(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });

  it('пустой ИНН и мусор с буквами → fetch не зовётся', async () => {
    const { rerender } = render(<InnDuplicateHint inn="" cardHrefBase="/manager/organizations" />);
    await settle(1000);
    rerender(<InnDuplicateHint inn="77070838ab" cardHrefBase="/manager/organizations" />);
    await settle(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('10 цифр с пробелами и дефисами → fetch нормализованного ИНН после 400мс (не раньше)', async () => {
    render(<InnDuplicateHint inn=" 7707 083-893 " cardHrefBase="/manager/organizations" />);
    await settle(399);
    expect(fetchMock).not.toHaveBeenCalled();
    await settle(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/duplicates/by-inn?inn=7707083893');
  });

  it('12 цифр с дефисами → фетчит после 400мс', async () => {
    render(<InnDuplicateHint inn="7707-0838-93-12" cardHrefBase="/admin/organizations" />);
    await settle(400);
    expect(fetchMock).toHaveBeenCalledWith('/api/duplicates/by-inn?inn=770708389312');
  });
});

describe('InnDuplicateHint — рендер плашки', () => {
  it('организации — ссылки cardHrefBase/id в новой вкладке; лиды — с русскими статусами', async () => {
    render(<InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />);
    await settle(400);

    expect(screen.getByText('Уже есть в базе:')).toBeTruthy();
    const link1 = screen.getByRole('link', { name: 'ООО Ромашка' });
    expect(link1.getAttribute('href')).toBe('/manager/organizations/o1');
    expect(link1.getAttribute('target')).toBe('_blank');
    expect(link1.getAttribute('rel')).toBe('noreferrer');
    expect(screen.getByRole('link', { name: 'ООО Василёк' }).getAttribute('href')).toBe(
      '/manager/organizations/o2'
    );
    expect(screen.getByText('Лид: Обучение ОТ (Новый)')).toBeTruthy();
    expect(screen.getByText('Лид: Повторное обучение (На рассмотрении)')).toBeTruthy();
  });

  it('admin-база ссылок: /admin/organizations/<id>; неизвестный статус лида — как есть', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        duplicates: {
          organizations: [{ id: 'o9', name: 'АО Пион' }],
          leads: [{ id: 'l9', subject: 'Старый лид', status: 'mystery_status' }],
        },
      })
    );
    render(<InnDuplicateHint inn="7707083893" cardHrefBase="/admin/organizations" />);
    await settle(400);
    expect(screen.getByRole('link', { name: 'АО Пион' }).getAttribute('href')).toBe(
      '/admin/organizations/o9'
    );
    expect(screen.getByText('Лид: Старый лид (mystery_status)')).toBeTruthy();
  });

  it('excludeOrganizationId прячет саму организацию, остальные остаются', async () => {
    render(
      <InnDuplicateHint
        inn="7707083893"
        cardHrefBase="/admin/organizations"
        excludeOrganizationId="o1"
      />
    );
    await settle(400);
    expect(screen.queryByRole('link', { name: 'ООО Ромашка' })).toBeNull();
    expect(screen.getByRole('link', { name: 'ООО Василёк' })).toBeTruthy();
  });

  it('единственный дубль — сама организация (exclude) и лидов нет → плашки нет вовсе', async () => {
    fetchMock.mockResolvedValue(
      okJson({ duplicates: { organizations: [{ id: 'self', name: 'Я сама' }], leads: [] } })
    );
    render(
      <InnDuplicateHint
        inn="7707083893"
        cardHrefBase="/admin/organizations"
        excludeOrganizationId="self"
      />
    );
    await settle(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });

  it('пустые дубли → ничего не рендерим', async () => {
    fetchMock.mockResolvedValue(okJson({ duplicates: { organizations: [], leads: [] } }));
    render(<InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />);
    await settle(400);
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });
});

describe('InnDuplicateHint — тихая деградация', () => {
  it.each([
    ['403 forbidden', { ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }],
    ['429 rate-limit', { ok: false, status: 429, json: async () => ({ error: 'rate_limited' }) }],
  ])('%s → молча ничего', async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    render(<InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />);
    await settle(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });

  it('сетевая ошибка → молча ничего (unhandled rejection нет)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    render(<InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />);
    await settle(400);
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });
});

describe('InnDuplicateHint — смена ИНН', () => {
  it('смена ИНН сразу гасит устаревшую плашку (до ответа нового запроса)', async () => {
    const { rerender } = render(
      <InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />
    );
    await settle(400);
    expect(screen.getByText('Уже есть в базе:')).toBeTruthy();

    // Новый ИНН: ответ подвешен — плашка обязана погаснуть немедленно.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    rerender(<InnDuplicateHint inn="770708389312" cardHrefBase="/manager/organizations" />);
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();

    await settle(400);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/duplicates/by-inn?inn=770708389312');
    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });

  it('опоздавший ответ по старому ИНН игнорируется (гонка запросов)', async () => {
    // Пользователь допечатывает ИНН быстрее, чем отвечает сервер. Ответ на
    // предыдущий ИНН приходит последним — и не должен подменить плашку чужими
    // дублями. Именно так пользователю показали бы «дубли» несуществующей
    // организации.
    let resolveStale: ((v: unknown) => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        })
    );

    const { rerender } = render(
      <InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />
    );
    await settle(400); // запрос по первому ИНН ушёл и завис

    // Второй ИНН: его ответ подвешиваем, чтобы плашку не рисовал он.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    rerender(<InnDuplicateHint inn="770708389312" cardHrefBase="/manager/organizations" />);
    await settle(400);

    // Теперь отвечает ПЕРВЫЙ, уже неактуальный запрос.
    await act(async () => {
      resolveStale?.(okJson({ duplicates: DUPLICATES }));
    });

    expect(screen.queryByText('Уже есть в базе:')).toBeNull();
  });

  it('нормализация не гасит плашку: «7707083893» → «7707 083-893» остаётся той же', async () => {
    const { rerender } = render(
      <InnDuplicateHint inn="7707083893" cardHrefBase="/manager/organizations" />
    );
    await settle(400);
    expect(screen.getByText('Уже есть в базе:')).toBeTruthy();

    rerender(<InnDuplicateHint inn="7707 083-893" cardHrefBase="/manager/organizations" />);
    expect(screen.getByText('Уже есть в базе:')).toBeTruthy();
  });
});
