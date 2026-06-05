# Arch-debt C4: error-contract drift → §3 Result-type — design

**Дата:** 2026-06-05
**Автор:** Claude (session-driven, post-exploration)
**Статус:** Approved (scope + design выбраны пользователем), pending implementation
**Related:** Трек C / **C4** из [completion-roadmap](2026-06-02-completion-roadmap.md). Под-проблема #2 из improvement-backlog. C3 (§2 direction) — отдельный shipped PR #90.

## Проблема

CLAUDE.md §3: все доменные функции в `src/lib/services/**` возвращают стабильный Result-тип `Promise<{ ok: true; …data } | { ok: false; error: ErrorCode }>`; роут/server-action **только мапит** код в HTTP. Два сервиса дрейфят — **бросают** типизированные ошибки вместо Result:

- `src/lib/services/admin/users.ts` (416 стр.) — `throw new AdminUserError(code)` в 4 мутациях.
- `src/lib/services/partner/leadAttachments.ts` (312 стр.) — `throw new LeadAttachmentError(code, message, meta?)` в 4 функциях.

Оба уже используют типизированные классы со стабильными кодами (когерентно), но вызывающие вынуждены `try/catch` + `instanceof`, что и есть дрейф от §3.

## Решение: boundary try/catch (не throw→return по всему телу)

Внутренние `throw new XError(...)` и rollback-семантика **не трогаются**. Меняется только **публичная граница** функции: оборачиваем тело в `try/catch`, ловим доменный класс → возвращаем Result, неожиданные ошибки (сбой БД/storage) **пробрасываем** (они не доменные).

```ts
export async function createUser(...): Promise<CreateUserOk | AdminUserFailure> {
  try {
    /* существующая логика без изменений, включая throw внутри $transaction */
    return { ok: true, ...data };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}
```

**Почему так, а не замена каждого `throw` на `return {ok:false}`:** часть throws живёт внутри `prisma.$transaction(async tx => …)` как валидационные guard'ы перед записями. Бросок откатывает транзакцию; `return {ok:false}` из callback'а её **закоммитил** бы. Boundary-catch сохраняет rollback точно, даёт минимальный diff и §3-контракт для вызывающих. Класс ошибки остаётся как внутренний control-flow-механизм (экспортируется, но вызывающие его больше не ловят).

## Дизайн по файлам

### `admin/users.ts` — pure-code Result (ошибки без сообщений)

`AdminUserErrorCode` уже экспортирован — переиспользуем. `admin/partners.ts` импортирует только **тип** `AdminUserErrorCode` → **не трогается**.

| Функция | Было | Стало |
|---|---|---|
| `createUser` | `Promise<CreateUserResult>` | `Promise<{ ok: true; user; inviteToken } \| { ok: false; error: AdminUserErrorCode }>` |
| `updateUser` | `Promise<UserDetail>` | `Promise<{ ok: true; user: UserDetail } \| { ok: false; error }>` |
| `deactivateUser` | `Promise<void>` | `Promise<{ ok: true } \| { ok: false; error }>` |
| `reactivateUser` | `Promise<void>` | `Promise<{ ok: true } \| { ok: false; error }>` |
| `getUser`, `listUsers` | не бросают (read / `\|null`) | **без изменений** (§3 не нарушают) |

Тип-хелпер в файле: `type AdminUserFailure = { ok: false; error: AdminUserErrorCode };`.

**Вызывающий — `server-actions/admin/users.ts`:** уже делает Result через `mapErr` (ловит `AdminUserError`). Конвертация: убрать импорт класса `AdminUserError` и хелпер `mapErr`; в каждой из 4 actions заменить `try { await svc(); … } catch (e) { return mapErr(e); }` на `const r = await svc(); if (!r.ok) return r; /* далее r.user/r.inviteToken */`. Внешний контракт server-action (`{ok:false, error: code}`) **не меняется** → его тест проходит как есть. Неожиданные ошибки теперь пробрасываются сервисом и всплывают так же, как раньше через `mapErr`-rethrow.

### `partner/leadAttachments.ts` — rich Result (сохраняем message + meta)

Ошибки несут русский `message` и `meta.scanReason` (INFECTED), которые роуты кладут в тело ответа. Чтобы поведение роутов не менялось — Result богатый:

```ts
export type LeadAttachmentErrorCode =
  | 'NOT_FOUND' | 'FORBIDDEN' | 'UNSUPPORTED_MEDIA_TYPE' | 'FILE_TOO_LARGE'
  | 'INVALID_FILENAME' | 'STORAGE_FAILURE' | 'LEAD_NOT_EDITABLE' | 'INFECTED';
export type LeadAttachmentFailure = {
  ok: false; error: LeadAttachmentErrorCode; message: string;
  meta?: { scanReason?: string | null };
};
```

(Извлекаем inline-union из конструктора `LeadAttachmentError` в именованный экспортируемый `LeadAttachmentErrorCode`; конструктор использует его же.)

| Функция | Стало |
|---|---|
| `uploadLeadAttachment` | `Promise<{ ok: true; attachment: LeadAttachment } \| LeadAttachmentFailure>` |
| `deleteLeadAttachment` | `Promise<{ ok: true } \| LeadAttachmentFailure>` |
| `getLeadAttachmentDownloadUrl` | `Promise<{ ok: true; url; name; mimeType } \| LeadAttachmentFailure>` |
| `listLeadAttachments` | `Promise<{ ok: true; rows: LeadAttachmentRow[] } \| LeadAttachmentFailure>` |

Хелпер: `function toFailure(e: unknown): LeadAttachmentFailure { if (e instanceof LeadAttachmentError) return { ok:false, error:e.code, message:e.message, ...(e.meta?{meta:e.meta}:{}) }; throw e; }`. Компенсация в `uploadLeadAttachment` (удаление orphan-объекта при сбое транзакции, строки 173-177) — **внутренний** try/catch, остаётся; boundary-catch снаружи.

**Вызывающие — 3 роута** (`attachments/route.ts` GET+POST, `[attachmentId]/route.ts` DELETE, `[attachmentId]/download/route.ts` GET): `mapErrorToResponse(err: unknown)` → `mapFailureToResponse(f: LeadAttachmentFailure)`, switch на `f.error`, тело из `f.message` / `f.meta?.scanReason` — **статусы и тела ответов байт-в-байт те же**. Каждый роут: `try { await svc(); … } catch(err){ return map(err) }` → `const r = await svc(); if (!r.ok) return mapFailureToResponse(r); /* r.rows / r.url / 204 */`. Убрать импорт класса `LeadAttachmentError`, импортировать тип `LeadAttachmentFailure`.

**Вызывающий — `partner/leads/[id]/page.tsx:47`:** `const attRes = await listLeadAttachments(…); const attachments = attRes.ok ? attRes.rows : [];` (lead уже подтверждён `getLead`+`notFound()` выше, NOT_FOUND недостижим → пустой fallback безопасен).

## Out of scope

- `getUser`/`listUsers` — не бросают; не конвертируем (§3 не нарушают, конверсия = churn без выгоды).
- Переименование кодов ошибок; смена HTTP-статусов; смена текстов сообщений.
- Прочие сервисы (вне C4).

## Tests (контракт меняется → тесты в lockstep)

- `services.admin.users.test.ts` (integration) — assert'ы `.rejects.toThrow`/`.code` → `expect(r.ok).toBe(false); expect(r.error).toBe('code')`; success → `r.ok===true` + поля.
- `api.partner.leads.attachments.test.ts` — тестирует HTTP-ответы роутов; ответы неизменны → **должен пройти как есть** (если не дергает сервис напрямую с assert на throw — проверить при impl).
- `server-actions.admin.users.test.ts` — внешний контракт server-action неизменен → **как есть**.
- Гейт: `npm run typecheck` (union-narrowing у всех вызывающих), `npm run lint`, оба service-теста + api-тест (`test:integration`/`test:unit` по слою), полный unit, `next build`.

## Принятые решения (по выбору пользователя)

1. **Scope = оба файла** (полный C4).
2. **leadAttachments — rich Result** (`message`+`meta` в Result), чтобы поведение роутов не менялось. admin/users — pure-code (сообщений нет).
3. **boundary try/catch** (rollback сохранён), классы ошибок остаются внутренним механизмом.

## Риск

Низкий-средний. Type-driven: `tsc` ловит каждый непокрытый Result-branch у вызывающих. Поведение (статусы/тела/rollback/compensation) сохранено намеренно. Тонкость — не сломать rollback (решено boundary-catch'ем) и не потерять message/scanReason (решено rich Result). Полностью покрыто typecheck + существующими тестами на тех же кодах.
