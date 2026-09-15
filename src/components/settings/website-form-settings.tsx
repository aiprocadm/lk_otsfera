'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/ui/page-header';
import { buildSettingsBreadcrumbs } from '@/lib/navigation/settings';
import { useFormAction } from '@/lib/ui/useFormAction';
import { issueSiteTokenAction, saveWebsiteSettingsAction } from '@/server-actions/admin/website';

/**
 * «Настройки → Интеграции → Сайт» (`У-211`).
 *
 * Экран отвечает на три вопроса (§15): где я — заголовок и крошки; что здесь
 * делают — подзаголовок; что делать дальше — кнопка «Выпустить токен», без
 * которого приём не работает.
 *
 * Токен виден ровно один раз, сразу после выпуска. Это не неудобство, а
 * правило хранения секретов: наружу значение не отдаётся никогда, в форме
 * остаётся только «задан».
 */
const ERROR_LABEL: Record<string, string> = {
  too_many_origins: 'Слишком много доменов — оставьте не больше пяти.',
  unknown_manager: 'Выбранный сотрудник больше не работает или сменил роль — выберите другого.',
  save_failed: 'Не удалось сохранить. Проверьте, задан ли ключ шифрования секретов.',
  validation: 'Проверьте заполнение полей.',
};

/** Готовый код формы для вставки на сайт. */
function snippet(origin: string, token: string): string {
  return `<form id="otsfera-request">
  <input name="companyName" placeholder="Организация" required>
  <input name="contactName" placeholder="Ваше имя" required>
  <input name="contactPhone" placeholder="Телефон">
  <input name="contactEmail" type="email" placeholder="Почта">
  <input name="subject" placeholder="Тема обращения" required>
  <textarea name="body" placeholder="Комментарий"></textarea>
  <label><input type="checkbox" name="consent" required> Согласен на обработку персональных данных</label>
  <!-- Поле-ловушка: спрятано от людей, его заполняют только роботы. Не удалять. -->
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button type="submit">Отправить</button>
</form>
<script>
document.getElementById('otsfera-request').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const res = await fetch('${origin}/api/public/requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-site-token': '${token}' },
    body: JSON.stringify({
      companyName: f.get('companyName'),
      contactName: f.get('contactName'),
      contactPhone: f.get('contactPhone') || undefined,
      contactEmail: f.get('contactEmail') || undefined,
      subject: f.get('subject'),
      body: f.get('body') || undefined,
      consent: f.get('consent') === 'on',
      website: f.get('website') || undefined,
    }),
  });
  alert(res.ok ? 'Заявка отправлена' : 'Не удалось отправить, попробуйте позже');
});
</script>`;
}

export function WebsiteFormSettings({
  enabled,
  allowedOrigins,
  defaultManagerId,
  tokenIsSet,
  appOrigin,
  managers,
}: {
  enabled: boolean;
  allowedOrigins: string;
  defaultManagerId: string;
  /** Токен уже выпущен? Значение наружу не отдаётся никогда. */
  tokenIsSet: boolean;
  /** Адрес кабинета — подставляется в готовый код формы. */
  appOrigin: string;
  managers: { id: string; name: string }[];
}) {
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const settings = useFormAction<object>({
    action: (formData) =>
      saveWebsiteSettingsAction({
        enabled: formData.get('enabled') === 'on',
        allowedOrigins: String(formData.get('allowedOrigins') ?? ''),
        defaultManagerId: String(formData.get('defaultManagerId') ?? ''),
      }),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: () => toast.success('Настройки сохранены'),
  });

  const issue = useFormAction<{ token: string }>({
    action: () => issueSiteTokenAction(),
    errorMap: ERROR_LABEL,
    refresh: true,
    onSuccess: (data) => {
      setIssuedToken(data.token);
      toast.success('Токен выпущен — скопируйте его сейчас');
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={buildSettingsBreadcrumbs('admin', '/admin/settings/integrations/website')}
        title="Сайт"
        subtitle="Приём заявок с формы на сайте: заявка попадёт во «Входящие в работу», как обращение из кабинета."
      />

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Токен формы</h2>
          <Badge tone={tokenIsSet ? 'success' : 'warning'}>
            {tokenIsSet ? 'Задан' : 'Не задан'}
          </Badge>
        </div>
        <p className="text-xs text-gray-500">
          Токен подтверждает, что заявка пришла с вашего сайта. Он показывается <b>один раз</b> —
          сразу после выпуска. Новый выпуск отзывает прежний: форма со старым токеном перестанет
          отправлять заявки, не забудьте обновить код на сайте.
        </p>
        {issuedToken && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">
              Скопируйте токен сейчас — больше он не покажется:
            </p>
            <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">
              {issuedToken}
            </code>
          </div>
        )}
        <form action={issue.formAction}>
          <Button type="submit" loading={issue.pending} disabled={issue.pending}>
            {tokenIsSet ? 'Выпустить новый токен' : 'Выпустить токен'}
          </Button>
        </form>
        {issue.errorText && (
          <p role="alert" className="text-xs text-red-600">
            {issue.errorText}
          </p>
        )}
      </section>

      <form
        action={settings.formAction}
        className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
      >
        <h2 className="text-sm font-semibold text-gray-700">Приём заявок</h2>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={enabled}
            disabled={settings.pending}
          />
          Принимать заявки с сайта
        </label>
        <div>
          <label className="text-xs text-gray-500" htmlFor="allowedOrigins">
            Домены сайта — по одному в строке, не больше пяти. Пусто — принимать с любого.
          </label>
          <Textarea
            id="allowedOrigins"
            name="allowedOrigins"
            rows={3}
            defaultValue={allowedOrigins}
            placeholder="https://otsfera.ru"
            disabled={settings.pending}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500" htmlFor="defaultManagerId">
            Кому сообщать о заявке. Не выбрано — сообщим всем менеджерам и руководителям.
          </label>
          <select
            id="defaultManagerId"
            name="defaultManagerId"
            defaultValue={defaultManagerId}
            disabled={settings.pending}
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">Всем менеджерам</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={settings.pending} disabled={settings.pending}>
          Сохранить
        </Button>
        {settings.errorText && (
          <p role="alert" className="text-sm text-red-600">
            {settings.errorText}
          </p>
        )}
      </form>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-700">Код формы для сайта</h2>
        <p className="text-xs text-gray-500">
          Вставьте этот код на страницу сайта. Подставьте в него выпущенный токен вместо{' '}
          <code>ВАШ_ТОКЕН</code>. Поле-ловушку не удаляйте: по нему отсеиваются роботы.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-800">
          {snippet(appOrigin, issuedToken ?? 'ВАШ_ТОКЕН')}
        </pre>
      </section>
    </div>
  );
}
