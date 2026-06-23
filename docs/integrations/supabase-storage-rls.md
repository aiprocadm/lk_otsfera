# Supabase Storage RLS for `documents` bucket

> ⚠️ **УСТАРЕЛО (2026-06-22).** Хранилище файлов мигрировало с Supabase Storage на
> S3-совместимое (152-ФЗ → файлы=ПДн должны оставаться в РФ; см. `ObjectStorage`-порт +
> `src/lib/storage/s3.ts`, CHANGELOG `[Unreleased]`, CLAUDE.md §10). Supabase-зависимость
> удалена из кода, поэтому описанные ниже Supabase RLS-политики **в проде не применяются**.
> Изоляция доступа к файлам держится прикладным слоем (RBAC + service scope) и presigned-URL
> с TTL 600 сек. Документ сохранён как исторический референс для S3-эквивалента
> (bucket-policy / IAM-условия на стороне S3-провайдера).

**Status:** ИСТОРИЧЕСКИЙ референс (Supabase удалён). policy template — apply manually via Supabase Dashboard or CLI.
**Scope:** bucket `documents`, all object operations.
**Last updated:** 2026-05-22 (Phase 3 plan).

## Why RLS at the storage layer

Application code already enforces access via `requirePartner`/`requirePartnerAdmin` guards and
service-layer scope filters (e.g. `assignedOrgIds`). Storage RLS is **defense in depth**:

- Mitigates risk of a leaked anon key.
- Prevents direct Storage REST calls from bypassing application logic.
- Required if/when we expose anon-key signed-URL flows or direct-from-browser uploads
  (currently all uploads go through server-side `service_role`).

Until those flows exist, the policies below act as a safety net — never as the primary control.

## Object path conventions

Every object in `documents` is stored under one of the following prefixes (enforced by
service-layer code, not by Storage itself):

| Use case               | Path template                                        |
| ---------------------- | ---------------------------------------------------- |
| Order document         | `partners/{partnerId}/organizations/{orgId}/orders/{orderId}/{cuid}.{ext}` |
| Organization document  | `partners/{partnerId}/organizations/{orgId}/{cuid}.{ext}` |
| Lead attachment        | `partners/{partnerId}/leads/{leadId}/{cuid}.{ext}`   |
| Commission statement   | `partners/{partnerId}/commission/{statementId}.pdf`  |

Server-side code generates these paths; clients never construct them.

## JWT claims required by policies

The JWT issued by `signToken()` (see `src/lib/auth/jwt.ts`) includes:

- `partnerId: string | null` — present for `role=partner`
- `organizationId: string | null` — present for `role=organization`
- `role: 'admin' | 'manager' | 'partner' | 'organization' | 'student'`

Supabase Storage uses `auth.jwt()` to access these inside policy `USING` clauses.

> **Note:** today these JWTs are issued by the cabinet's own login flow (HS256 / `JWT_SECRET`),
> not by Supabase Auth. To make Storage RLS effective in production we will need to either
> (a) sign the cabinet JWTs with Supabase's `SUPABASE_JWT_SECRET`, or
> (b) call `supabase.auth.setSession()` with a separate Supabase-signed token.
> Today's flow uses the `service_role` key on the server, which **bypasses RLS** — so these
> policies are dormant. They are pre-staged so that the path layout, claim names, and SQL
> are reviewed and version-controlled.

## SQL — apply with Supabase CLI

```sql
-- Enable RLS on storage.objects (Supabase enables this by default; idempotent).
alter table storage.objects enable row level security;

-- Policy: partner-scoped read.
-- Allows users with role='partner' to read any object under their partner prefix.
create policy "partner can read own partner objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (auth.jwt() ->> 'role') = 'partner'
    and (auth.jwt() ->> 'partnerId') is not null
    and name like 'partners/' || (auth.jwt() ->> 'partnerId') || '/%'
  );

-- Policy: organization-scoped read.
-- Allows users with role='organization' to read only objects under their org prefix.
create policy "organization can read own org objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (auth.jwt() ->> 'role') = 'organization'
    and (auth.jwt() ->> 'organizationId') is not null
    and name like 'partners/%/organizations/' || (auth.jwt() ->> 'organizationId') || '/%'
  );

-- Policy: admin read-everything escape hatch.
create policy "admin can read all documents bucket objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (auth.jwt() ->> 'role') = 'admin'
  );

-- Policy: NO direct write/update/delete via anon or authenticated keys.
-- Service-role key bypasses RLS, so server-side flows still work.
-- (Explicit policies below would be redundant — absence of an INSERT/UPDATE/DELETE
-- policy means it is implicitly denied for non-service-role callers.)
```

## How to apply

### Option A — Supabase Dashboard (one-time, by admin)

1. Navigate to **Storage → Policies → `documents` bucket**.
2. Paste the SQL above into the policy editor for each policy in turn.
3. Verify each policy appears under the `documents` bucket's policy list.

### Option B — Supabase CLI (preferred for IaC)

Save the SQL above as `supabase/migrations/20260522_storage_rls.sql` and run:

```sh
supabase db push
```

Storage policies are stored in `storage.policies` and survive `supabase db reset` only if
the migration file is present.

## Verification checklist

After applying, with a partner-role JWT in `Authorization: Bearer ...`:

- [ ] `GET /storage/v1/object/documents/partners/<own-partner-id>/...` — `200` (allowed).
- [ ] `GET /storage/v1/object/documents/partners/<other-partner-id>/...` — `403` (denied).
- [ ] `POST` (direct upload) using the same anon-key JWT — `403` (denied: no insert policy).
- [ ] Server-side upload via `service_role` (current cabinet code path) — `200` (bypasses RLS).

## Out of scope (later phases)

- **Anon-key direct-from-browser uploads** — once enabled, will require an `INSERT` policy that
  validates the path matches the uploader's claims. Plan in Phase 5+ when virus scanning is
  added.
- **Signed-URL TTL hardening** — currently uses 5-minute TTL for downloads (Phase 3); no policy
  change needed.
- **Supabase Auth migration** — switch cabinet sessions to Supabase-signed JWTs so the
  policies above become enforced (today the cabinet uses HS256 with `JWT_SECRET`, distinct
  from `SUPABASE_JWT_SECRET`).
