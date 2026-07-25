'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';

/**
 * Форма подачи обращения клиента (этап 5, ФТ-1.2). Shared presentational для
 * partner/organization (сознательное исключение из sibling-паттерна: поля
 * идентичны по ролям, сервер сам выводит источник и принадлежность из сессии).
 */
export function ClientRequestForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [inn, setInn] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  function reset() {
    setCompanyName('');
    setInn('');
    setContactName('');
    setContactPhone('');
    setContactEmail('');
    setSubject('');
    setBody('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/client-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName,
          inn: inn || null,
          contactName,
          contactPhone: contactPhone || null,
          contactEmail: contactEmail || null,
          subject,
          body: body || null
        })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; messages?: string[] };
        if (data.messages?.length) setErrors(data.messages);
        else toast.error(`Не удалось отправить обращение: ${data.error ?? res.status}`);
        return;
      }
      toast.success('Обращение отправлено — менеджер свяжется с вами');
      reset();
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <div>
        <h2 className='font-semibold text-[#111111]'>Новое обращение</h2>
        <p className='text-xs text-gray-500 mt-0.5'>
          Опишите запрос — менеджер рассмотрит обращение и свяжется с вами.
        </p>
      </div>
      <form onSubmit={submit} className='space-y-3'>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
          <Field htmlFor='cr-company' label='Название компании *'>
            <Input
              id='cr-company'
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </Field>
          <Field htmlFor='cr-inn' label='ИНН' hint='10 или 12 цифр, если известен'>
            <Input id='cr-inn' value={inn} onChange={(e) => setInn(e.target.value)} />
          </Field>
          <Field htmlFor='cr-contact' label='Контактное лицо *'>
            <Input
              id='cr-contact'
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
            />
          </Field>
          <Field htmlFor='cr-subject' label='Тема *'>
            <Input
              id='cr-subject'
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </Field>
          <Field htmlFor='cr-phone' label='Телефон' hint='Телефон или email — хотя бы одно'>
            <Input
              id='cr-phone'
              type='tel'
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </Field>
          <Field htmlFor='cr-email' label='Email' hint='Телефон или email — хотя бы одно'>
            <Input
              id='cr-email'
              type='email'
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </Field>
        </div>
        <Field htmlFor='cr-body' label='Описание'>
          <Textarea id='cr-body' rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        {errors.length > 0 && (
          <ul className='text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 space-y-0.5' role='alert'>
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}

        <div className='flex justify-end'>
          <Button type='submit' loading={busy}>
            Отправить обращение
          </Button>
        </div>
      </form>
    </section>
  );
}
