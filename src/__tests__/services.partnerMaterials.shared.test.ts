import { describe, it, expect } from 'vitest';
import {
  PARTNER_MATERIAL_CATEGORIES,
  PARTNER_MATERIAL_CATEGORY_LABELS,
  PARTNER_MATERIAL_HTTP_STATUS,
  PARTNER_MATERIAL_MIME_TYPES,
  isNewMaterial,
  isValidExternalUrl,
  materialStoragePath,
  parseMaterialCategory,
  validateMaterialFile,
} from '@/lib/services/partnerMaterials/shared';

/** Справочники материалов для партнёров (`У-237`). */

const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj', 'binary');

describe('справочники', () => {
  it('категории — пять, у каждой русская подпись; разбор строки — только известное', () => {
    expect(PARTNER_MATERIAL_CATEGORIES).toHaveLength(5);
    for (const c of PARTNER_MATERIAL_CATEGORIES) {
      expect(PARTNER_MATERIAL_CATEGORY_LABELS[c]).toMatch(/[А-Яа-яЁё]/);
    }
    expect(parseMaterialCategory('price_list')).toBe('price_list');
    expect(parseMaterialCategory('xxx')).toBeUndefined();
    expect(parseMaterialCategory(undefined)).toBeUndefined();
  });

  it('форматы: документы плюс презентации; коды сервиса → HTTP-статусы', () => {
    expect(PARTNER_MATERIAL_MIME_TYPES.has('application/pdf')).toBe(true);
    expect(
      PARTNER_MATERIAL_MIME_TYPES.has(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      )
    ).toBe(true);
    expect(PARTNER_MATERIAL_MIME_TYPES.has('application/zip')).toBe(false);
    expect(PARTNER_MATERIAL_HTTP_STATUS).toMatchObject({
      forbidden: 403,
      not_found: 404,
      validation: 400,
      too_large: 413,
      invalid_mime: 415,
      storage: 502,
    });
  });
});

describe('validateMaterialFile', () => {
  it('размер, формат, magic-bytes', () => {
    expect(
      validateMaterialFile({
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: PDF.length,
        buffer: PDF,
      })
    ).toEqual({ ok: true });
    expect(
      validateMaterialFile({
        name: 'big.pdf',
        mimeType: 'application/pdf',
        size: 500 * 1024 * 1024,
        buffer: PDF,
      })
    ).toEqual({ ok: false, error: 'too_large' });
    expect(
      validateMaterialFile({ name: 'a.zip', mimeType: 'application/zip', size: 10, buffer: PDF })
    ).toEqual({ ok: false, error: 'invalid_mime' });
    // Подделка: расширение и MIME говорят «PDF», содержимое — нет.
    const fake = Buffer.from('MZ not a pdf at all');
    expect(
      validateMaterialFile({
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: fake.length,
        buffer: fake,
      })
    ).toEqual({ ok: false, error: 'invalid_mime' });
    // Презентация: magic-bytes не проверяем (формат вне SUPPORTED), пропускаем по MIME.
    expect(
      validateMaterialFile({
        name: 'p.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        size: 10,
        buffer: Buffer.from('PKxxxx'),
      })
    ).toEqual({ ok: true });
  });
});

describe('помощники', () => {
  it('путь в хранилище — по компании, имя файла очищено', () => {
    const p = materialStoragePath('c1', 'прайс лист 2026.pdf');
    expect(p).toMatch(/^company\/c1\/partner-materials\/[0-9a-f-]{36}-[A-Za-z0-9._-]+\.pdf$/);
    expect(p).not.toMatch(/[а-яА-Я ]/);
    expect(p.endsWith('2026.pdf')).toBe(true);
  });

  it('«Новое» — 7 дней после публикации', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    expect(isNewMaterial(new Date('2026-09-15T12:00:00Z'), now)).toBe(true);
    expect(isNewMaterial(new Date('2026-09-01T12:00:00Z'), now)).toBe(false);
    expect(isNewMaterial(null, now)).toBe(false);
  });

  it('ссылка — только http(s)', () => {
    expect(isValidExternalUrl('https://example.com/x')).toBe(true);
    expect(isValidExternalUrl('ftp://example.com')).toBe(false);
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isValidExternalUrl('не ссылка')).toBe(false);
  });
});
