import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `У-322` (ТЗ 28.10.2026, ДП §1 п. 2): в прод-стеке есть антивирус, и воркер
 * его дожидается.
 *
 * Без сервиса `clamav` скан в production отказывается помечать файл `clean`
 * (`scan-document.ts`): документы навсегда остаются `pending`, а скачивание
 * блокирует только `infected` — проверка фактически выключена. Ни один
 * модульный тест этого не видит: код скана исправен, не хватает соседа в
 * compose. Поэтому страж читает сам `docker-compose.prod.yml`.
 */
// Комментарии YAML (`#` в начале строки или после пробела) снимаются: иначе
// закомментированный сервис `clamav` сошёл бы за настоящий.
const compose = readFileSync(join(__dirname, '..', '..', 'docker-compose.prod.yml'), 'utf8')
  .split('\n')
  .map((line) => line.replace(/(^|\s)#.*$/, ''))
  .join('\n');

/** Блок сервиса верхнего уровня: от `  name:` до следующего сервиса или `volumes:`. */
function serviceBlock(name: string): string {
  const start = compose.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  expect(start, `в docker-compose.prod.yml нет сервиса ${name}`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const end = rest.search(/^(?: {2}[a-z][\w-]*:\s*$|\S)/m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('docker-compose.prod.yml — антивирус в прод-стеке (`У-322`)', () => {
  it('сервис clamav с проверкой здоровья и томом баз сигнатур', () => {
    const clamav = serviceBlock('clamav');
    expect(clamav).toMatch(/image:\s*clamav\/clamav:/);
    expect(clamav, 'без healthcheck воркер не сможет его дождаться').toContain('clamdcheck.sh');
    expect(clamav, 'базы сигнатур качались бы заново при каждом рестарте').toMatch(
      /clamdb:\/var\/lib\/clamav/
    );
    expect(compose, 'том clamdb не объявлен').toMatch(/^volumes:[\s\S]*^\s{2}clamdb:/m);
  });

  it('воркер стартует только при здоровом антивирусе', () => {
    expect(serviceBlock('worker')).toMatch(/clamav:\s*\n\s*condition:\s*service_healthy/);
  });
});

// `У-338` (ТЗ 28.10.2026, ДП §5): образ по тегу из реестра. Жёсткий
// `lk-otsfera:prod` делал откат пересборкой — теперь откат = прежний тег.
describe('прод-стек: образ приложения по тегу (У-338)', () => {
  it.each(['migrate', 'web', 'worker'])('%s берёт образ по обязательному IMAGE_TAG', (name) => {
    const image = /^\s+image:\s*(.+?)\s*$/m.exec(serviceBlock(name))?.[1];
    expect(image).toBe('${IMAGE_REPO:-lk-otsfera}:${IMAGE_TAG:?IMAGE_TAG is required}');
  });

  it('жёстко зашитого тега приложения не осталось', () => {
    expect(compose).not.toMatch(/lk-otsfera:prod\b/);
  });
});
