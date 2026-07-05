'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';

type OrgOption = { id: string; name: string };

/**
 * Presentational, domain-agnostic enrollment submit form (CLAUDE.md §4: shared
 * primitive, not per-role siblings — the shape is identical for all roles). Posts
 * to the role-agnostic /api/enrollments; the server derives partnerId/org scope
 * from the session. `organizations` is optional (partner/manager may pick one).
 */
export function EnrollmentRequestForm({ organizations }: { organizations?: OrgOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [note, setNote] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/enrollments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentName, studentEmail, courseTitle, organizationId: organizationId || null, note: note || null })
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(`Не удалось отправить заявку: ${err.error ?? res.status}`);
        return;
      }
      toast.success('Заявка на обучение отправлена');
      setStudentName(''); setStudentEmail(''); setCourseTitle(''); setOrganizationId(''); setNote('');
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F97316]';

  return (
    <form onSubmit={submit} className='rounded-xl border border-gray-200 p-4 space-y-3 max-w-xl'>
      <h2 className='text-sm font-semibold text-[#111111]'>Новая заявка на обучение</h2>
      <div className='grid gap-3 sm:grid-cols-2'>
        <input className={inputCls} placeholder='ФИО слушателя' value={studentName} onChange={(e) => setStudentName(e.target.value)} required />
        <input className={inputCls} type='email' placeholder='Email слушателя' value={studentEmail} onChange={(e) => setStudentEmail(e.target.value)} required />
      </div>
      <input className={inputCls} placeholder='Курс / программа' value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} required />
      {organizations && organizations.length > 0 && (
        <select className={inputCls} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
          <option value=''>Организация (необязательно)</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      )}
      <textarea className={inputCls} rows={2} placeholder='Примечание (необязательно)' value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type='submit' loading={busy} disabled={busy}>Отправить заявку</Button>
    </form>
  );
}
