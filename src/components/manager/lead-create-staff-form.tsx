'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { createLeadByStaffAction } from '@/server-actions/manager/create-lead';

export type LeadCreateOrgOption = { id: string; name: string };

/**
 * Модалка ручного создания лида сотрудником (этап 5, ФТ-1.6): кнопка
 * «Создать лид» + Dialog с полями как у обращения клиента, примечанием и
 * необязательным выбором организации компании.
 */
export function LeadCreateStaffForm({ organizations }: { organizations: LeadCreateOrgOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [inn, setInn] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [organizationId, setOrganizationId] = useState('');

  function reset() {
    setErrors([]);
    setCompanyName('');
    setInn('');
    setContactName('');
    setContactPhone('');
    setContactEmail('');
    setSubject('');
    setNotes('');
    setOrganizationId('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await createLeadByStaffAction({
        companyName,
        inn: inn || null,
        contactName,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        subject,
        notes: notes || null,
        organizationId: organizationId || null
      });
      if (!res.ok) {
        setErrors(
          res.messages?.length ? res.messages : ['Не удалось создать лид — недостаточно прав']
        );
        return;
      }
      setOpen(false);
      reset();
      toast.success('Лид создан');
      router.refresh();
    } catch {
      setErrors(['Сетевая ошибка — попробуйте ещё раз']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Создать лид</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setErrors([]);
        }}
        title='Новый лид'
        size='lg'
        busy={busy}
        error={
          errors.length > 0 ? (
            <ul className='space-y-0.5'>
              {errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          ) : null
        }
      >
        <form onSubmit={submit} className='space-y-3'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <Field htmlFor='lcs-company' label='Название компании *'>
              <Input
                id='lcs-company'
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </Field>
            <Field htmlFor='lcs-inn' label='ИНН'>
              <Input id='lcs-inn' value={inn} onChange={(e) => setInn(e.target.value)} />
            </Field>
            <Field htmlFor='lcs-contact' label='Контактное лицо *'>
              <Input
                id='lcs-contact'
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
              />
            </Field>
            <Field htmlFor='lcs-subject' label='Тема *'>
              <Input
                id='lcs-subject'
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              />
            </Field>
            <Field htmlFor='lcs-phone' label='Телефон' hint='Телефон или email — хотя бы одно'>
              <Input
                id='lcs-phone'
                type='tel'
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </Field>
            <Field htmlFor='lcs-email' label='Email' hint='Телефон или email — хотя бы одно'>
              <Input
                id='lcs-email'
                type='email'
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </Field>
          </div>
          {organizations.length > 0 && (
            <Field htmlFor='lcs-org' label='Организация'>
              <Select
                id='lcs-org'
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
              >
                <option value=''>— без организации —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field htmlFor='lcs-notes' label='Примечание'>
            <Textarea
              id='lcs-notes'
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='secondary'
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setErrors([]);
              }}
            >
              Отмена
            </Button>
            <Button type='submit' loading={busy}>
              Создать лид
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
