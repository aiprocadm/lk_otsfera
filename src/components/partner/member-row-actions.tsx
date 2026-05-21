'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

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
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const deactivateDialogRef = useRef<HTMLDialogElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set(initialAssignedOrgIds));
  const [allOrgs, setAllOrgs] = useState<boolean>(initialAssignedOrgIds.length === 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEdit() {
    setSelected(new Set(initialAssignedOrgIds));
    setAllOrgs(initialAssignedOrgIds.length === 0);
    setError(null);
    editDialogRef.current?.showModal();
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
        setError(typeof body.error === 'string' ? body.error : 'Ошибка сохранения');
        return;
      }
      editDialogRef.current?.close();
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
          body.error === 'LAST_ADMIN'
            ? 'Нельзя деактивировать последнего админа'
            : typeof body.error === 'string' ? body.error : 'Ошибка'
        );
        return;
      }
      deactivateDialogRef.current?.close();
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
          onClick={() => deactivateDialogRef.current?.showModal()}
          className='px-2.5 py-1 text-xs border border-red-100 text-red-700 rounded hover:bg-red-50'
        >
          Удалить
        </button>
      </div>

      <dialog
        ref={editDialogRef}
        className='rounded-xl p-0 max-w-lg w-[92vw] backdrop:bg-black/40'
        onClose={() => setError(null)}
      >
        <form
          method='dialog'
          onSubmit={(e) => {
            e.preventDefault();
            saveOrgs();
          }}
          className='p-5 space-y-4'
        >
          <div>
            <h3 className='text-base font-semibold text-[#111111]'>Доступ к организациям</h3>
            <p className='text-xs text-gray-500 mt-1'>{name}</p>
          </div>

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

          {error && (
            <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
              {error}
            </div>
          )}

          <div className='flex justify-end gap-2 pt-2 border-t border-gray-100'>
            <button
              type='button'
              onClick={() => editDialogRef.current?.close()}
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
      </dialog>

      <dialog
        ref={deactivateDialogRef}
        className='rounded-xl p-0 max-w-md w-[92vw] backdrop:bg-black/40'
        onClose={() => setError(null)}
      >
        <div className='p-5 space-y-4'>
          <div>
            <h3 className='text-base font-semibold text-[#111111]'>Деактивировать сотрудника?</h3>
            <p className='text-sm text-gray-500 mt-1'>
              <strong className='text-[#111111]'>{name}</strong> потеряет доступ к кабинету.
              Историю и аудит это не затронет.
            </p>
          </div>

          {error && (
            <div className='text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2'>
              {error}
            </div>
          )}

          <div className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => deactivateDialogRef.current?.close()}
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
      </dialog>
    </>
  );
}
