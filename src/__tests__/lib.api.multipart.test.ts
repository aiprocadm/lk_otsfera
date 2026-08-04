/**
 * Общий разбор multipart для файловых роутов (`src/lib/api/multipart.ts`).
 *
 * Тест пинит именно те расхождения семантики, ради которых заведены опции:
 * duck-опознание файла, «пустой файл = его нет», коэрции строковых полей.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readMultipart, readFileEntry, readFile, formFields } from '@/lib/api/multipart';

function formReq(fd: FormData): Request {
  return new Request('http://x/', { method: 'POST', body: fd });
}

describe('readMultipart', () => {
  it('multipart-тело → FormData', async () => {
    const fd = new FormData();
    fd.set('a', '1');
    const form = await readMultipart(formReq(fd));
    expect(form?.get('a')).toBe('1');
  });

  it('не-multipart тело → null (код ответа выбирает роут)', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      body: 'plain',
      headers: { 'content-type': 'text/plain' },
    });
    expect(await readMultipart(req)).toBeNull();
  });
});

describe('readFileEntry', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' });

  function form(entries: Record<string, string | File>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  }

  it('поля нет → null', () => {
    expect(readFileEntry(form({}), 'file')).toBeNull();
  });

  it('поле — строка → null', () => {
    expect(readFileEntry(form({ file: 'x' }), 'file')).toBeNull();
  });

  it('поле — File → сам File (буфер не читается)', () => {
    expect(readFileEntry(form({ file }), 'file')?.name).toBe('a.pdf');
  });

  it('detect=duck опознаёт файл по методу arrayBuffer', () => {
    expect(readFileEntry(form({ file }), 'file', { detect: 'duck' })?.name).toBe('a.pdf');
    expect(readFileEntry(form({ file: 'x' }), 'file', { detect: 'duck' })).toBeNull();
  });

  it('skipEmpty=true: файл нулевого размера считается отсутствующим', () => {
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
    expect(readFileEntry(form({ file: empty }), 'file', { skipEmpty: true })).toBeNull();
    // без опции пустой файл — обычный файл
    expect(readFileEntry(form({ file: empty }), 'file')?.name).toBe('empty.pdf');
    // и непустой файл опция не трогает
    expect(readFileEntry(form({ file }), 'file', { skipEmpty: true })?.name).toBe('a.pdf');
  });
});

describe('readFile', () => {
  it('возвращает name/type/size/buffer', async () => {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' }));
    const res = await readFile(fd, 'file');
    expect(res).toMatchObject({ name: 'a.pdf', type: 'application/pdf', size: 3 });
    expect(Buffer.isBuffer(res?.buffer)).toBe(true);
    expect([...(res?.buffer ?? [])]).toEqual([1, 2, 3]);
  });

  it('поля нет → null', async () => {
    expect(await readFile(new FormData(), 'file')).toBeNull();
  });
});

describe('formFields', () => {
  it('z.coerce.string().default() повторяет String(v ?? default)', () => {
    const schema = z.object({
      a: z.coerce.string().default(''),
      b: z.coerce.string().default('other'),
    });
    const fd = new FormData();
    fd.set('a', 'x');
    expect(formFields(fd, schema)).toEqual({ a: 'x', b: 'other' });
  });

  it('z.string().catch() повторяет typeof v === "string" ? v : ""', () => {
    const schema = z.object({ a: z.string().catch(''), b: z.string().catch('') });
    const fd = new FormData();
    fd.set('a', new File(['x'], 'f.pdf', { type: 'application/pdf' }));
    expect(formFields(fd, schema)).toEqual({ a: '', b: '' });
  });

  it('повтор ключа: берётся первое значение (как FormData#get)', () => {
    const fd = new FormData();
    fd.append('a', 'first');
    fd.append('a', 'second');
    expect(formFields(fd, z.object({ a: z.string().catch('') }))).toEqual({ a: 'first' });
  });

  it('нетотальная схема — ошибка программиста: бросает (контракт задокументирован)', () => {
    expect(() => formFields(new FormData(), z.object({ a: z.string() }))).toThrow();
  });
});
