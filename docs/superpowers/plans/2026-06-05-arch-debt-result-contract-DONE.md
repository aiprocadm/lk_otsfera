# Arch-debt C4: error-contract → §3 Result-type — close-out (DONE)

**Дата:** 2026-06-05 · **Ветка:** `claude/c4-result-contract` · **Спека:** [arch-debt-result-contract-design](../specs/2026-06-05-arch-debt-result-contract-design.md) · **План:** [arch-debt-result-contract](2026-06-05-arch-debt-result-contract.md)

Компаньон к плану (не замена). План — «что собирались», этот файл — «что отгрузили». Трек **C / C4** из [completion-roadmap](../specs/2026-06-02-completion-roadmap.md).

## Статус

**Отгружено, 4 коммита:** `dc5293b` (spec+plan), `2a55959` (admin/users), `def9f64` (leadAttachments), close-out. Реализация — inline; ревью — короткоживущий субагент (clean по всем 8 пунктам). Реализовано через **boundary try/catch**: внутренние throws и `$transaction`-rollback не тронуты, публичная граница конвертирует доменный класс в Result, неожиданные ошибки пробрасываются.

## Что отгрузили

Два сервиса приведены к §3 Result-контракту (`{ ok: true; … } | { ok: false; error; … }`), все вызывающие обновлены.

| Слой | Содержимое |
|---|---|
| `admin/users.ts` | `createUser`/`updateUser`/`deactivateUser`/`reactivateUser` → **pure-code** Result `{ok:false, error: AdminUserErrorCode}`. `getUser`/`listUsers` (не бросают) не тронуты. Класс `AdminUserError` + код-тип остаются (внутренний механизм). |
| admin caller | `server-actions/admin/users.ts`: убран `mapErr` + 4 блока try/catch → `if (!r.ok) return r`; внешний `{ok,error}`-контракт server-action неизменен. `admin/partners.ts` — type-only reuse, не тронут. |
| `leadAttachments.ts` | `upload`/`delete`/`getDownloadUrl`/`list` → **rich** Result `{ok:false, error, message, meta?}` (несёт русский `message` + `scanReason`). Хелпер `toFailure`. Компенсация orphan-объекта в upload — внутренний try, сохранена. |
| leadAtt. callers | 3 роута: `mapErrorToResponse`→`mapFailureToResponse`, Result-check + тонкий generic-500 catch для инфра-ошибок. Ответы (статусы/тела, **INFECTED 410 + scanReason**) — байт-в-байт те же. Страница `partner/leads/[id]` читает Result с `[]`-fallback. |
| Тесты | `services.admin.users` (throw→Result-ассерты + success-narrowing), `server-actions.admin.users` (моки rejected→resolved Result), `api.partner.leads.attachments` (моки rejected→resolved rich Result). |

## Верификация

- **typecheck** чисто (union-narrowing форсит каждую ветку у вызывающих) · **lint** чисто · `instanceof` доменных классов — **только внутри 2 сервисов** (вызывающие используют Result).
- **unit: 1082** (135 файлов) · **integration: 334** (45 файлов, полный L3) · **`next build`** собрался.
- Целевые тесты: admin services+server-action (52), leadAtt. routes (12) — все статусы/тела подтверждены.
- **Независимое ревью (субагент):** clean — rollback сохранён, компенсация цела, ответы идентичны, доменные ошибки не утекают, success-shape без потерь полей, моки корректны.

## Принятые решения (выбор пользователя)

1. **Scope = оба файла** (полный C4).
2. **leadAttachments — rich Result** (message+meta), чтобы поведение роутов не менялось; admin/users — pure-code.
3. **boundary try/catch** (rollback сохранён), классы ошибок — внутренний механизм.

## Не-issues / отложено (задокументировано, не тихие пробелы)

- Vestigial mock-класс `LeadAttachmentError` в фабрике `api.partner.leads.attachments.test.ts` — безвреден (держит surface мок-модуля полным). Можно убрать позже.
- `AdminUserError`/`LeadAttachmentError` классы остаются **экспортированными**, хотя вне сервисов больше не используются — это намеренный внутренний throw-механизм boundary-паттерна (не утечка).
- Generic `catch { 500 }` в роутах сохранён ради идентичности поведения (инфра-ошибки → JSON-500, как раньше) — это не доменная логика, а инфра-fallback.

## Гочи для будущего

- **boundary try/catch — единственный безопасный способ конвертации, когда throws живут внутри `$transaction`.** Замена `throw`→`return {ok:false}` из callback'а транзакции **закоммитила** бы её (вместо rollback). Все валидационные guard'ы здесь стоят до записей, но паттерн boundary-catch делает это неважным и сохраняет rollback дословно.
- **Конвертация контракта атомарна по стороне:** сервис + все вызывающие + тесты — один коммит, иначе typecheck падает на полпути и pre-commit хук блокирует. Поэтому 2 рабочих коммита (admin / leadAttachments), каждый typecheck-зелёный.
- **Моки сервиса в тестах — самая хрупкая часть:** error-мок, оставшийся `mockRejectedValue`, после конвертации уводит роут в generic-500 и **молча** ослабляет ассерт (тест «проходит», но проверяет не то). Все переведены на `mockResolvedValue({ok:false,...})`.
- Оба изменённых сервиса покрыты только **unit**-тестами (мокнутый prisma) — integration-теста у них нет; L3 их не гоняет, но полный L3 (334) подтвердил отсутствие collateral.
