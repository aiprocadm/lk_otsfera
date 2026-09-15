import { describe, it, expect } from 'vitest';
import {
  httpDeliveryError,
  networkDeliveryError,
  notConfiguredDeliveryError,
  safeDeliveryError,
} from '@/lib/messengers/deliveryError';

/**
 * Причина недоставки (`У-213`, этап 3 PR-7).
 *
 * У этого текста два хозяина сразу: его читает ЧЕЛОВЕК в ленте диалога и его
 * хранит БАЗА. Значит, требований тоже два, и второе — про секреты. Ошибка
 * сети от Telegram приходит вместе с адресом запроса, а в адресе стоит токен
 * бота: `api.telegram.org/bot<токен>/sendMessage`. Один раз положить такую
 * строку в базу — значит раздать ключ от бота всем, кто видит переписку.
 */
describe('safeDeliveryError — секреты не доезжают до экрана и базы', () => {
  const RAW = 'fetch failed: https://api.telegram.org/bot123456:AAH_secret/sendMessage';

  it('токен бота Telegram вычищается из текста', () => {
    const out = safeDeliveryError(RAW);
    expect(out).not.toContain('123456:AAH_secret');
    expect(out).not.toContain('AAH_secret');
    expect(out).toBe('fetch failed: https://api.telegram.org/bot[REDACTED]/sendMessage');
  });

  it('остальной текст сохраняется — иначе причина перестанет быть причиной', () => {
    expect(safeDeliveryError(RAW)).toContain('fetch failed');
  });

  it('несколько адресов в одной строке чистятся все', () => {
    const out = safeDeliveryError(
      'retry https://api.telegram.org/bot1:AAA/sendMessage then /bot2:BBB/getMe'
    );
    expect(out).not.toMatch(/AAA|BBB/);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it('общая чистка продолжает работать: почтовый адрес', () => {
    // Адрес клиента — это ПДн; в базе причин ему не место (§12).
    expect(safeDeliveryError('отказ по адресу ivan.petrov@example.com')).toBe(
      'отказ по адресу [REDACTED]'
    );
  });

  it('общая чистка продолжает работать: токен-JWT в тексте', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF-123';
    expect(safeDeliveryError(`Unauthorized: ${jwt}`)).toBe('Unauthorized: [REDACTED]');
  });

  it('общая чистка продолжает работать: секрет в параметре запроса', () => {
    // Общая чистка знает формы `?token=`, `?secret=`, `?key=` — ровно их и
    // проверяем. (Слитную форму `access_token=` она НЕ ловит; сегодня это
    // безопасно, потому что клиент MAX не подмешивает адрес запроса в текст
    // причины, — см. отчёт по этапу.)
    expect(safeDeliveryError('GET /send?token=SuperSecret&chat=1')).toBe(
      'GET /send?token=[REDACTED]&chat=1'
    );
    expect(safeDeliveryError('GET /x?secret=abc')).not.toContain('abc');
  });
});

describe('safeDeliveryError — длина и пустота', () => {
  it('длинная простыня провайдера обрезается до одной строки', () => {
    const out = safeDeliveryError('я'.repeat(500));
    expect(out).toHaveLength(300);
    // Многоточие говорит человеку, что текст продолжался.
    expect(out.endsWith('…')).toBe(true);
  });

  it('ровно предельная длина не портится многоточием', () => {
    const out = safeDeliveryError('я'.repeat(300));
    expect(out).toHaveLength(300);
    expect(out.endsWith('…')).toBe(false);
  });

  it('пустая строка и пробелы → «Причина неизвестна», а не пустое место', () => {
    // Пустота в ленте читается как «всё в порядке», а сообщение не ушло.
    expect(safeDeliveryError('')).toBe('Причина неизвестна');
    expect(safeDeliveryError('   \n  ')).toBe('Причина неизвестна');
  });

  it('лишние пробелы по краям срезаются', () => {
    expect(safeDeliveryError('  бот заблокирован  ')).toBe('бот заблокирован');
  });
});

describe('готовые формулировки причин', () => {
  it('401 и 403 — это отказ, а не поломка: так и написано', () => {
    // Человеку важна разница: «нас не пускают» решается ключами в настройках,
    // а «ответил ошибкой 500» — ожиданием и повтором.
    expect(httpDeliveryError('Telegram', 401)).toBe('Telegram отклонил отправку (401)');
    expect(httpDeliveryError('MAX', 403)).toBe('MAX отклонил отправку (403)');
  });

  it('прочие коды — обычная ошибка с номером', () => {
    expect(httpDeliveryError('WhatsApp', 500)).toBe('WhatsApp ответил ошибкой 500');
  });

  it('подробность провайдера добавляется через двоеточие', () => {
    expect(httpDeliveryError('Telegram', 400, 'chat not found')).toBe(
      'Telegram ответил ошибкой 400: chat not found'
    );
  });

  it('подробность тоже чистится — провайдер любит вернуть наш же запрос', () => {
    const out = httpDeliveryError('Telegram', 404, 'POST /bot777:ZZZ/sendMessage');
    expect(out).not.toContain('ZZZ');
  });

  it('сеть не ответила — отдельная формулировка без кода', () => {
    expect(networkDeliveryError('MAX')).toBe(
      'MAX недоступен: сеть не ответила или истекло время ожидания'
    );
  });

  it('канал не настроен — это к администратору, и текст говорит именно так', () => {
    expect(notConfiguredDeliveryError('WhatsApp')).toBe(
      'WhatsApp не настроен: не заданы ключи в настройках интеграций'
    );
  });
});
