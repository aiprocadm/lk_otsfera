'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPartnerWithAdminAction } from '@/server-actions/admin/partners';
import { useFormAction } from '@/lib/ui/useFormAction';

const ERROR_MAP: Record<string, string> = {
  duplicate_slug: 'Slug занят. Выберите другой.',
  duplicate_email: 'Email уже зарегистрирован.',
  validation: 'Проверьте поля.',
};

export function PartnerCreateForm() {
  const router = useRouter();
  const { formAction, pending, errorText, data } = useFormAction<{
    partner: { id: string; name: string; slug: string };
    user: { id: string; email: string };
    inviteUrl: string;
  }>({ action: createPartnerWithAdminAction, errorMap: ERROR_MAP });
  const inviteUrl = data?.inviteUrl ?? null;
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function copyInviteUrl() {
    // Defensive fallback: the "Скопировать" button only renders once inviteUrl is truthy
    // (see the `{inviteUrl && ...}` success block below), so this guard is unreachable via the UI.
    /* v8 ignore next */
    if (!inviteUrl) return;
    void navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function validateSlug(value: string) {
    if (value && !/^[a-z0-9-]+$/.test(value)) {
      setSlugError('Только строчные буквы, цифры и дефис');
    } else {
      setSlugError(null);
    }
  }

  return (
    <form
      action={formAction}
      className="space-y-4 bg-white border border-gray-200 rounded-xl p-6 max-w-xl"
    >
      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Название партнёра</label>
        <input
          type="text"
          name="name"
          required
          maxLength={200}
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Slug</label>
        <input
          type="text"
          name="slug"
          required
          maxLength={80}
          onBlur={(e) => validateSlug(e.target.value)}
          onChange={(e) => {
            if (slugError) validateSlug(e.target.value);
          }}
          className={`w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] ${slugError ? 'border-red-400' : 'border-gray-200'}`}
        />
        {slugError && <p className="text-xs text-red-600 mt-1">{slugError}</p>}
        <p className="text-xs text-gray-500 mt-1">
          Строчные буквы, цифры и дефис. Например: <span className="font-mono">my-partner</span>
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-[#111111] mb-1">Ставка комиссии, %</label>
        <input
          type="number"
          name="commissionRate"
          min={0}
          max={100}
          step="any"
          placeholder="5"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
        />
        <p className="text-xs text-gray-500 mt-1">0–100% (необязательно)</p>
      </div>
      <fieldset className="border border-gray-200 rounded-lg p-4 space-y-4">
        <legend className="text-sm font-medium text-[#111111] px-1">Администратор партнёра</legend>
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Email</label>
          <input
            type="email"
            name="adminEmail"
            required
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#111111] mb-1">Имя</label>
          <input
            type="text"
            name="adminName"
            required
            maxLength={200}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </div>
      </fieldset>
      {errorText && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
          {errorText}
        </div>
      )}
      {inviteUrl && (
        <div role="status" className="text-sm bg-green-50 text-green-700 rounded px-3 py-2">
          Партнёр создан. Приглашение для администратора:
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              className="flex-1 border border-green-200 rounded px-2 py-1 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={copyInviteUrl}
              className="px-3 py-1.5 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C] whitespace-nowrap"
            >
              {copied ? 'Скопировано!' : 'Скопировать'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => router.push('/admin/partners')}
            className="mt-3 px-3 py-1.5 border border-gray-200 rounded text-sm text-gray-700 hover:bg-gray-50"
          >
            К списку
          </button>
        </div>
      )}
      {!inviteUrl && (
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-[#F97316] text-white text-sm rounded hover:bg-[#EA580C] disabled:opacity-60"
        >
          {pending ? 'Создаю…' : 'Создать партнёра'}
        </button>
      )}
    </form>
  );
}
