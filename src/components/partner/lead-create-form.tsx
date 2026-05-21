'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type OrgOption = { id: string; name: string };

const PRODUCT_OPTIONS = [
  { value: 'training', label: 'Обучение' },
  { value: 'service', label: 'Услуги' },
  { value: 'supply', label: 'Поставка' }
];

export function LeadCreateForm({ orgs }: { orgs: OrgOption[] }) {
  const router = useRouter();

  const [organizationId, setOrganizationId] = useState<string>('');
  const [clientCompanyName, setClient] = useState('');
  const [clientInn, setInn] = useState('');
  const [clientContactName, setContactName] = useState('');
  const [clientContactPhone, setContactPhone] = useState('');
  const [clientContactEmail, setContactEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [productType, setProductType] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleProduct(v: string) {
    setProductType((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function pickOrg(id: string) {
    setOrganizationId(id);
    const org = orgs.find((o) => o.id === id);
    if (org && !clientCompanyName) setClient(org.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const estimatedNum = estimatedAmount.trim()
      ? Number(estimatedAmount.replace(/\s/g, '').replace(',', '.'))
      : null;
    if (estimatedNum !== null && (!Number.isFinite(estimatedNum) || estimatedNum < 0)) {
      setError('Оценка суммы должна быть положительным числом');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/partner/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationId: organizationId || null,
          clientCompanyName: clientCompanyName.trim(),
          clientInn: clientInn.trim() || null,
          clientContactName: clientContactName.trim(),
          clientContactPhone: clientContactPhone.trim() || null,
          clientContactEmail: clientContactEmail.trim() || null,
          subject: subject.trim(),
          estimatedAmount: estimatedNum,
          productType: [...productType],
          notes: notes.trim() || null
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'ORG_OUT_OF_SCOPE') {
          setError('Эта организация недоступна в вашем scope');
        } else if (body.error === 'Invalid payload') {
          setError('Проверьте корректность заполненных полей');
        } else {
          setError(body.error ?? 'Не удалось создать заявку');
        }
        return;
      }

      const { id } = (await res.json()) as { id: string };
      router.push(`/partner/leads/${id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const valid =
    clientCompanyName.trim().length > 0 &&
    clientContactName.trim().length > 0 &&
    subject.trim().length > 0;

  return (
    <form onSubmit={submit} className='space-y-5 bg-white border border-gray-200 rounded-xl p-5'>
      <Section title='Клиент' hint='Кому адресована заявка'>
        {orgs.length > 0 && (
          <label className='block'>
            <span className='text-sm text-gray-700'>Организация из портфеля</span>
            <select
              value={organizationId}
              onChange={(e) => pickOrg(e.target.value)}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
            >
              <option value=''>— Новая (вне портфеля)</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className='block'>
          <span className='text-sm text-gray-700'>Название компании *</span>
          <input
            type='text'
            value={clientCompanyName}
            onChange={(e) => setClient(e.target.value)}
            required
            maxLength={255}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
            placeholder='ООО «Ромашка»'
          />
        </label>

        <label className='block'>
          <span className='text-sm text-gray-700'>ИНН</span>
          <input
            type='text'
            value={clientInn}
            onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))}
            maxLength={12}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
            placeholder='7707083893'
          />
        </label>
      </Section>

      <Section title='Контакт' hint='С кем общаться по заявке'>
        <label className='block'>
          <span className='text-sm text-gray-700'>Имя контактного лица *</span>
          <input
            type='text'
            value={clientContactName}
            onChange={(e) => setContactName(e.target.value)}
            required
            maxLength={255}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
            placeholder='Иван Петров'
          />
        </label>

        <div className='grid md:grid-cols-2 gap-3'>
          <label className='block'>
            <span className='text-sm text-gray-700'>Телефон</span>
            <input
              type='tel'
              value={clientContactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              maxLength={64}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
              placeholder='+7 ...'
            />
          </label>

          <label className='block'>
            <span className='text-sm text-gray-700'>Email</span>
            <input
              type='email'
              value={clientContactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
              placeholder='contact@company.ru'
            />
          </label>
        </div>
      </Section>

      <Section title='Запрос' hint='Что нужно клиенту'>
        <label className='block'>
          <span className='text-sm text-gray-700'>Тема *</span>
          <textarea
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            rows={2}
            maxLength={500}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316] resize-y'
            placeholder='Обучение электробезопасности, 25 чел.'
          />
        </label>

        <div className='grid md:grid-cols-2 gap-3'>
          <label className='block'>
            <span className='text-sm text-gray-700'>Оценочная сумма (₽)</span>
            <input
              type='text'
              inputMode='decimal'
              value={estimatedAmount}
              onChange={(e) => setEstimatedAmount(e.target.value)}
              className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316]'
              placeholder='150000'
            />
          </label>

          <div>
            <span className='text-sm text-gray-700 block mb-1'>Тип услуг</span>
            <div className='flex flex-wrap gap-1.5'>
              {PRODUCT_OPTIONS.map((opt) => {
                const active = productType.has(opt.value);
                return (
                  <button
                    type='button'
                    key={opt.value}
                    onClick={() => toggleProduct(opt.value)}
                    className={`px-3 py-1.5 text-xs rounded-full border ${
                      active
                        ? 'bg-[#F97316] text-white border-[#F97316]'
                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <label className='block'>
          <span className='text-sm text-gray-700'>Комментарий для менеджера</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className='mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316] resize-y'
            placeholder='Особенности заявки, сроки, контекст…'
          />
        </label>
      </Section>

      {error && (
        <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
          {error}
        </div>
      )}

      <div className='flex justify-end gap-2 pt-2 border-t border-gray-100'>
        <button
          type='button'
          onClick={() => router.back()}
          className='px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50'
          disabled={submitting}
        >
          Отмена
        </button>
        <button
          type='submit'
          disabled={submitting || !valid}
          className='px-4 py-2 text-sm bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        >
          {submitting ? 'Создание…' : 'Создать заявку'}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className='space-y-3'>
      <legend className='text-sm font-semibold text-[#111111]'>{title}</legend>
      {hint && <p className='text-xs text-gray-500 -mt-2'>{hint}</p>}
      {children}
    </fieldset>
  );
}
