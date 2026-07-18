'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { errorMessageRu } from '@/lib/errors/messages';

export function MemberRowActions({
  userId,
  name,
  initialAssignedOrgIds,
  orgs
}: {
  userId: string;
  name: string;
  initialAssignedOrgIds: string[];
  orgs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set(initialAssignedOrgIds));
  const [allOrgs, setAllOrgs] = useState<boolean>(initialAssignedOrgIds.length === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit() {
    setSelected(new Set(initialAssignedOrgIds));
    setAllOrgs(initialAssignedOrgIds.length === 0);
    setError(null);
    setEditOpen(true);
  }

  function openDeactivate() {
    setError(null);
    setDeactivateOpen(true);
  }

  function toggleOrg(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveOrgs() {
    setError(null);
    setSubmitting(true);
    try {
      const assignedOrgIds = allOrgs ? [] : [...selected];
      const res = await fetch(`/api/partner/team/${userId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignedOrgIds })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          typeof body.error === 'string'
            ? errorMessageRu(body.error, 'Не удалось сохранить доступ. Попробуйте ещё раз.')
            : 'Не удалось сохранить доступ. Попробуйте ещё раз.'
        );
        return;
      }
      setEditOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/partner/team/${userId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error === 'last_admin_protected'
            ? 'Нельзя деактивировать последнего админа партнёра'
            : typeof body.error === 'string'
              ? errorMessageRu(body.error, 'Не удалось деактивировать. Попробуйте ещё раз.')
              : 'Не удалось деактивировать. Попробуйте ещё раз.'
        );
        return;
      }
      setDeactivateOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className='inline-flex gap-1'>
        <button
          type='button'
          onClick={openEdit}
          className='px-2.5 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50'
        >
          Доступ
        </button>
        <button
          type='button'
          onClick={openDeactivate}
          className='px-2.5 py-1 text-xs border border-red-100 text-red-700 rounded hover:bg-red-50'
        >
          Удалить
        </button>
      </div>

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title='Доступ к организациям'
        size='lg'
        busy={submitting}
        error={error}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveOrgs();
          }}
          className='space-y-4'
        >
          <p className='text-xs text-gray-500'>{name}</p>

          <label className='flex items-center gap-2 cursor-pointer'>
            <input
              type='checkbox'
              checked={allOrgs}
              onChange={(e) => setAllOrgs(e.target.checked)}
              className='accent-[#F97316]'
            />
            <span className='text-sm text-[#111111]'>Доступ ко всем организациям партнёра</span>
          </label>

          {!allOrgs && (
            <div className='max-h-72 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50'>
              {orgs.length === 0 ? (
                <div className='p-3 text-xs text-gray-500'>
                  В портфеле нет организаций.
                </div>
              ) : (
                orgs.map((org) => (
                  <label
                    key={org.id}
                    className='flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50'
                  >
                    <input
                      type='checkbox'
                      checked={selected.has(org.id)}
                      onChange={() => toggleOrg(org.id)}
                      className='accent-[#F97316]'
                    />
                    <span className='text-sm text-[#111111]'>{org.name}</span>
                  </label>
                ))
              )}
            </div>
          )}

          <div className='flex justify-end gap-2 pt-2 border-t border-gray-100'>
            <button
              type='button'
              onClick={() => setEditOpen(false)}
              className='px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50'
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type='submit'
              disabled={submitting || (!allOrgs && selected.size === 0)}
              className='px-4 py-2 text-sm bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
            >
              {submitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        title='Деактивировать сотрудника?'
        size='md'
        busy={submitting}
        error={error}
      >
        <div className='space-y-4'>
          <p className='text-sm text-gray-500'>
            <strong className='text-[#111111]'>{name}</strong> потеряет доступ к кабинету.
            Историю и аудит это не затронет.
          </p>

          <div className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => setDeactivateOpen(false)}
              className='px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50'
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type='button'
              onClick={deactivate}
              disabled={submitting}
              className='px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50'
            >
              {submitting ? 'Удаление…' : 'Деактивировать'}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
