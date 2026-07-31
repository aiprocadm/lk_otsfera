/**
 * Этап 11 PR-3 (ФТ-15.7) guardrail реестра уведомлений — по образцу
 * `pii.capture-coverage.guardrail`.
 *
 * 1) Каждый тип реестра действительно отправляется из заявленного файла.
 * 2) Файлы-продьюсеры не шлют типов мимо реестра.
 *
 * Ограничение (осознанное, как и у PII-гварда): проверяются только файлы,
 * заявленные реестром. Совсем новый продьюсер ловится ревью, а не этим тестом.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NOTIFICATION_TYPES } from '@/lib/notifications/registry';

const ROOT = process.cwd();

describe('Реестр типов уведомлений — guardrail', () => {
  it('каждый тип встречается в заявленном файле-продьюсере', () => {
    const missing: string[] = [];
    for (const [key, spec] of Object.entries(NOTIFICATION_TYPES)) {
      const src = readFileSync(path.join(ROOT, spec.producer), 'utf8');
      if (!src.includes(`'${key}'`)) missing.push(`${key} → ${spec.producer}`);
    }
    expect(
      missing,
      `Типы, которых нет в заявленном продьюсере:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('продьюсеры не отправляют типов мимо реестра', () => {
    const known = new Set(Object.keys(NOTIFICATION_TYPES));
    const files = [...new Set(Object.values(NOTIFICATION_TYPES).map((s) => s.producer))];
    const rogue: string[] = [];
    for (const file of files) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      // Тип уведомления передаётся как `type: '<key>'` в createNotification и
      // в union'ах продьюсеров.
      for (const m of src.matchAll(/\btype:\s*'([a-z0-9_]+)'/g)) {
        if (!known.has(m[1])) rogue.push(`${file}: ${m[1]}`);
      }
    }
    expect(rogue, `Типы, отправляемые мимо реестра:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('мёртвый enum NotificationType удалён из схемы', () => {
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/^enum NotificationType \{/m);
    // Поле остаётся строковым — реестр это контракт кода, а не тип БД.
    expect(schema).toMatch(/type\s+String/);
  });
});
