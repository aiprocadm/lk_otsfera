# Партнёрский кабинет — Фаза 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подготовить фундамент партнёрского кабинета: расширенная Prisma-схема (новые enums, расширения Order/Document/Partner/Organization, 6 новых моделей), Redis + BullMQ воркер со скелетом, fake-адаптер 1С с дет.данными, документ контракта интеграции с IT 1С.

**Architecture:** Prisma миграции — атомарная подача (одна миграция, много правок). Worker — отдельный процесс на BullMQ поверх Redis. 1С интегрируем через interface + adapter pattern (fake + rest), что отвязывает разработку UI от реального 1С. SyncLog — append-only аудит синхронизаций.

**Tech Stack:** Next.js 15, TypeScript, Prisma 5 (PostgreSQL), Vitest, BullMQ 5, ioredis 5, Zod, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-05-21-partner-cabinet-design.md`

**Estimated duration:** 1 неделя (1 разработчик full-time) или ~3 дня (2 разработчика параллельно: схема + инфра).

---

## Pre-flight: окружение и подготовка

Перед началом работ убедитесь:

- [ ] **Pre-1: Git identity настроена локально**

```bash
git config user.email "your-email@example.com"
git config user.name "Your Name"
# Проверить:
git config user.email
git config user.name
```

- [ ] **Pre-2: PostgreSQL поднят и доступен**

```bash
docker compose up -d db
# Подождать пока healthcheck зелёный (5-10 сек)
docker compose ps
# Ожидаемо: db running (healthy)
```

- [ ] **Pre-3: Зависимости установлены, Prisma client сгенерирован**

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
```

- [ ] **Pre-4: Базовый прогон тестов проходит**

```bash
npm test
# Ожидаемо: PASS все существующие тесты
```

- [ ] **Pre-5: Запомните baseline коммит**

```bash
git log -1 --oneline
# Запишите хэш — на него будете откатываться, если что
```

---

## Часть 1 — Расширение Prisma-схемы

### Task 1: Добавить новые enums

**Files:**
- Modify: `prisma/schema.prisma` (добавить новые enums после существующих)

- [ ] **Step 1.1: Написать integration-тест на доступность типов**

Создать файл `src/__tests__/schema.enums.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  ExecutionStatus,
  FinancialStatus,
  DocumentType,
  DocumentDirection,
  GenerationSource,
  NotificationType,
  LeadStatus,
  CommissionStatementStatus
} from '@prisma/client';

describe('Schema enums', () => {
  it('ExecutionStatus includes pending/in_progress/completed/cancelled/on_hold', () => {
    expect(Object.values(ExecutionStatus)).toEqual(
      expect.arrayContaining(['pending', 'in_progress', 'completed', 'cancelled', 'on_hold'])
    );
  });

  it('FinancialStatus includes not_billed..refunded', () => {
    expect(Object.values(FinancialStatus)).toEqual(
      expect.arrayContaining(['not_billed', 'billed', 'partially_paid', 'paid', 'refunded'])
    );
  });

  it('DocumentType covers all required document kinds', () => {
    expect(Object.values(DocumentType)).toEqual(
      expect.arrayContaining([
        'contract', 'extra_agreement', 'invoice', 'act', 'waybill',
        'certificate', 'report', 'commission_statement', 'other'
      ])
    );
  });

  it('DocumentDirection has incoming and outgoing', () => {
    expect(Object.values(DocumentDirection)).toEqual(
      expect.arrayContaining(['incoming', 'outgoing'])
    );
  });

  it('GenerationSource has user and system', () => {
    expect(Object.values(GenerationSource)).toEqual(
      expect.arrayContaining(['user', 'system'])
    );
  });

  it('NotificationType covers expected events', () => {
    expect(Object.values(NotificationType)).toEqual(
      expect.arrayContaining([
        'lead_status_changed', 'order_status_changed', 'payment_received',
        'document_uploaded', 'commission_statement_ready', 'mention_in_comment',
        'partner_assignment_changed', 'sync_error'
      ])
    );
  });

  it('LeadStatus has full lifecycle', () => {
    expect(Object.values(LeadStatus)).toEqual(
      expect.arrayContaining(['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected'])
    );
  });

  it('CommissionStatementStatus has draft..superseded', () => {
    expect(Object.values(CommissionStatementStatus)).toEqual(
      expect.arrayContaining(['draft', 'approved', 'paid', 'superseded'])
    );
  });
});
```

- [ ] **Step 1.2: Запустить тест — ожидаем FAIL**

```bash
npx vitest run src/__tests__/schema.enums.test.ts
# Ожидаемо: FAIL — типы не экспортируются из @prisma/client
```

- [ ] **Step 1.3: Добавить enums в `prisma/schema.prisma`**

Вставить ПОСЛЕ существующего `enum OrderStatus { ... }` (~строка 24):

```prisma
enum ExecutionStatus {
  pending
  in_progress
  completed
  cancelled
  on_hold
}

enum FinancialStatus {
  not_billed
  billed
  partially_paid
  paid
  refunded
}

enum DocumentType {
  contract
  extra_agreement
  invoice
  act
  waybill
  certificate
  report
  commission_statement
  other
}

enum DocumentDirection {
  incoming
  outgoing
}

enum GenerationSource {
  user
  system
}

enum NotificationType {
  lead_status_changed
  order_status_changed
  payment_received
  document_uploaded
  commission_statement_ready
  mention_in_comment
  partner_assignment_changed
  sync_error
}

enum LeadStatus {
  new
  in_review
  qualified
  promoted_to_order
  rejected
}

enum CommissionStatementStatus {
  draft
  approved
  paid
  superseded
}
```

- [ ] **Step 1.4: Регенерация Prisma client (без миграции — пока только типы)**

```bash
npm run prisma:generate
```

- [ ] **Step 1.5: Запустить тест — ожидаем PASS**

```bash
npx vitest run src/__tests__/schema.enums.test.ts
# Ожидаемо: PASS все 8 кейсов
```

- [ ] **Step 1.6: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.enums.test.ts
git commit -m "feat(schema): add partner cabinet enums (status, document, lead, etc.)"
```

---

### Task 2: Расширить модель Partner

**Files:**
- Modify: `prisma/schema.prisma` (модель `Partner`, ~строки 50-58)

- [ ] **Step 2.1: Написать тест — поля доступны**

Добавить в `src/__tests__/schema.partner.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Partner } from '@prisma/client';

describe('Partner model fields', () => {
  it('has commissionRate, legalName, slug fields in type', () => {
    expectTypeOf<Partner>().toHaveProperty('commissionRate');
    expectTypeOf<Partner>().toHaveProperty('legalName');
    expectTypeOf<Partner>().toHaveProperty('slug');
  });
});
```

- [ ] **Step 2.2: Запустить — FAIL** 

```bash
npx vitest run src/__tests__/schema.partner.test.ts
# FAIL: типы отсутствуют
```

- [ ] **Step 2.3: Расширить `Partner` в `prisma/schema.prisma`**

Найти `model Partner { ... }` и добавить поля:

```prisma
model Partner {
  id              String          @id @default(cuid())
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  name            String
  legalName       String?
  slug            String?         @unique
  commissionRate  Decimal         @default(0) @db.Decimal(6, 4)
  organizations   Organization[]
  users           User[]
  partnerUsers    PartnerUser[]
  leads           Lead[]
  commissionStatements CommissionStatement[]
  notifications   Notification[]
}
```

> `Decimal(6,4)` поддерживает значения вроде `0.1000` (10%), `0.0750` (7.5%) с 4 знаками после запятой. Достаточно для процентов.
> `partnerUsers`, `leads`, `commissionStatements` — relations, которые будут добавлены в последующих task-ах. Prisma ругаться не будет.

- [ ] **Step 2.4: `npm run prisma:generate`, тест — PASS**

```bash
npm run prisma:generate
npx vitest run src/__tests__/schema.partner.test.ts
```

- [ ] **Step 2.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.partner.test.ts
git commit -m "feat(schema): extend Partner with commissionRate/legalName/slug"
```

---

### Task 3: Расширить модель Organization

**Files:**
- Modify: `prisma/schema.prisma` (модель `Organization`)

- [ ] **Step 3.1: Тест на новые поля**

Создать `src/__tests__/schema.organization.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Organization } from '@prisma/client';

describe('Organization model fields', () => {
  it('has 1С linkage and per-org commission override', () => {
    expectTypeOf<Organization>().toHaveProperty('externalId');
    expectTypeOf<Organization>().toHaveProperty('inn');
    expectTypeOf<Organization>().toHaveProperty('kpp');
    expectTypeOf<Organization>().toHaveProperty('assignedManagerUserId');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRate');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRateNote');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRateChangedAt');
    expectTypeOf<Organization>().toHaveProperty('partnerCommissionRateChangedBy');
  });
});
```

- [ ] **Step 3.2: FAIL ожидаемо**

- [ ] **Step 3.3: Расширить модель**

```prisma
model Organization {
  id                              String              @id @default(cuid())
  createdAt                       DateTime            @default(now())
  updatedAt                       DateTime            @updatedAt
  name                            String
  externalId                      String?             @unique
  inn                             String?
  kpp                             String?
  partnerId                       String
  partner                         Partner             @relation(fields: [partnerId], references: [id])
  companyId                       String?
  company                         Company?            @relation(fields: [companyId], references: [id])
  assignedManagerUserId           String?
  partnerCommissionRate           Decimal?            @db.Decimal(6, 4)
  partnerCommissionRateNote       String?
  partnerCommissionRateChangedAt  DateTime?
  partnerCommissionRateChangedBy  String?
  students                        Student[]
  users                           User[]              @relation("UserOrganization")
  organizationUsers               OrganizationUser[]
  notifications                   Notification[]
  leads                           Lead[]

  @@index([partnerId])
  @@index([externalId])
}
```

- [ ] **Step 3.4: regenerate + тест PASS**

```bash
npm run prisma:generate
npx vitest run src/__tests__/schema.organization.test.ts
```

- [ ] **Step 3.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.organization.test.ts
git commit -m "feat(schema): extend Organization with 1С linkage and commission override"
```

---

### Task 4: Расширить модель Order (включая двухмерный статус)

**Files:**
- Modify: `prisma/schema.prisma` (модель `Order`)

- [ ] **Step 4.1: Тест на новые поля**

Создать `src/__tests__/schema.order.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Order, ExecutionStatus, FinancialStatus } from '@prisma/client';

describe('Order model fields', () => {
  it('has financial and execution split, totals, lifecycle timestamps', () => {
    expectTypeOf<Order>().toHaveProperty('externalId');
    expectTypeOf<Order>().toHaveProperty('orderNumber');
    expectTypeOf<Order>().toHaveProperty('totalAmount');
    expectTypeOf<Order>().toHaveProperty('paidAmount');
    expectTypeOf<Order>().toHaveProperty('paidAt');
    expectTypeOf<Order>().toHaveProperty('contractSignedAt');
    expectTypeOf<Order>().toHaveProperty('completedAt');
    expectTypeOf<Order>().toHaveProperty('closedAt');
    expectTypeOf<Order>().toHaveProperty('lastSyncedAt');
    expectTypeOf<Order>().toHaveProperty('partnerId');
    expectTypeOf<Order>().toHaveProperty('vatIncluded');
    expectTypeOf<Order>().toHaveProperty('vatRate');
    expectTypeOf<Order>().toHaveProperty('executionStatus');
    expectTypeOf<Order>().toHaveProperty('financialStatus');
    expectTypeOf<Order>().toHaveProperty('productMix');
  });
});
```

- [ ] **Step 4.2: FAIL ожидаемо**

- [ ] **Step 4.3: Расширить `Order`**

```prisma
model Order {
  id                  String              @id @default(cuid())
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  externalId          String?             @unique
  orderNumber         String?
  title               String
  status              OrderStatus         @default(new)
  executionStatus     ExecutionStatus     @default(pending)
  financialStatus     FinancialStatus     @default(not_billed)
  totalAmount         Decimal             @default(0) @db.Decimal(14, 2)
  paidAmount          Decimal             @default(0) @db.Decimal(14, 2)
  paidAt              DateTime?
  contractSignedAt    DateTime?
  completedAt         DateTime?
  closedAt            DateTime?
  lastSyncedAt        DateTime?
  vatIncluded         Boolean             @default(true)
  vatRate             Decimal?            @db.Decimal(5, 4)
  productMix          String[]
  deadline            DateTime?
  companyId           String
  company             Company             @relation(fields: [companyId], references: [id])
  partnerId           String?
  partner             Partner?            @relation(fields: [partnerId], references: [id])
  managerId           String?
  manager             User?               @relation("OrderManager", fields: [managerId], references: [id])
  documents           Document[]
  comments            Comment[]
  uploads             Upload[]
  payments            Payment[]
  promotedFromLead    Lead?               @relation("LeadPromoted")
  commissionItems     CommissionStatementItem[]

  @@index([partnerId, executionStatus])
  @@index([partnerId, financialStatus])
  @@index([externalId])
  @@index([closedAt])
}
```

> **Важно:** старое поле `status: OrderStatus` сохраняем для backward compat (миграция данных будет в отдельной задаче). Новые поля `executionStatus` и `financialStatus` — основные.
> Связь `partner` — null-able через `partnerId?`. Это потому что Order приходит из 1С и связь с Partner устанавливается на основе Organization.partnerId.

- [ ] **Step 4.4: regenerate + тест PASS**

```bash
npm run prisma:generate
npx vitest run src/__tests__/schema.order.test.ts
```

- [ ] **Step 4.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.order.test.ts
git commit -m "feat(schema): extend Order with two-dimensional status, totals, 1С linkage"
```

---

### Task 5: Расширить модель Document + сделать uploadedBy nullable

**Files:**
- Modify: `prisma/schema.prisma` (модель `Document`)

- [ ] **Step 5.1: Тест**

Создать `src/__tests__/schema.document.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Document } from '@prisma/client';

describe('Document model fields', () => {
  it('has type/direction/version/generationSource and nullable uploadedBy', () => {
    expectTypeOf<Document>().toHaveProperty('type');
    expectTypeOf<Document>().toHaveProperty('direction');
    expectTypeOf<Document>().toHaveProperty('version');
    expectTypeOf<Document>().toHaveProperty('replacesDocumentId');
    expectTypeOf<Document>().toHaveProperty('signedAt');
    expectTypeOf<Document>().toHaveProperty('generatedBy');
    expectTypeOf<Document>().toHaveProperty('externalId');
  });

  it('uploadedById is nullable to allow system-generated docs', () => {
    type Doc = Document;
    const sample: Doc['uploadedById'] = null;
    expect(sample).toBeNull();
  });
});
```

- [ ] **Step 5.2: FAIL**

- [ ] **Step 5.3: Изменить `Document`**

```prisma
model Document {
  id                  String              @id @default(cuid())
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  name                String
  path                String
  mimeType            String
  size                Int?
  type                DocumentType        @default(other)
  direction           DocumentDirection   @default(incoming)
  version             Int                 @default(1)
  replacesDocumentId  String?
  signedAt            DateTime?
  generatedBy         GenerationSource    @default(user)
  externalId          String?             @unique
  orderId             String
  order               Order               @relation(fields: [orderId], references: [id])
  uploadedById        String?
  uploadedBy          User?               @relation(fields: [uploadedById], references: [id])

  @@index([orderId, type])
  @@index([type, createdAt])
  @@index([externalId])
}
```

> Старое поле `uploadedById String` теперь `String?` — это **breaking change**, но в БД нет данных от продакшена (MVP в pre-prod). Если данные есть — миграция автоматически сделает поле nullable, существующие значения сохранятся.

- [ ] **Step 5.4: regenerate + тест PASS**

- [ ] **Step 5.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.document.test.ts
git commit -m "feat(schema): type/version Documents; nullable uploadedBy for system-generated"
```

---

### Task 6: Добавить модель PartnerUser

**Files:**
- Modify: `prisma/schema.prisma` (добавить новую модель)

- [ ] **Step 6.1: Тест**

Создать `src/__tests__/schema.partnerUser.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { PartnerUser } from '@prisma/client';

describe('PartnerUser model', () => {
  it('exists with required fields', () => {
    expectTypeOf<PartnerUser>().toHaveProperty('partnerId');
    expectTypeOf<PartnerUser>().toHaveProperty('userId');
    expectTypeOf<PartnerUser>().toHaveProperty('roleInPartner');
    expectTypeOf<PartnerUser>().toHaveProperty('assignedOrgIds');
    expectTypeOf<PartnerUser>().toHaveProperty('isActive');
  });
});
```

- [ ] **Step 6.2: FAIL**

- [ ] **Step 6.3: Добавить модель**

В `prisma/schema.prisma` добавить **новый блок** в конце файла:

```prisma
model PartnerUser {
  id              String   @id @default(cuid())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  partnerId       String
  partner         Partner  @relation(fields: [partnerId], references: [id])
  userId          String
  user            User     @relation("PartnerMembership", fields: [userId], references: [id])
  roleInPartner   String   @default("manager")
  assignedOrgIds  String[]
  isActive        Boolean  @default(true)

  @@unique([partnerId, userId])
  @@index([partnerId, isActive])
  @@index([userId])
}
```

Затем в `User { ... }` добавить relation:

```prisma
  partnerMemberships PartnerUser[] @relation("PartnerMembership")
```

- [ ] **Step 6.4: regenerate + тест PASS**

- [ ] **Step 6.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.partnerUser.test.ts
git commit -m "feat(schema): add PartnerUser model for sub-roles within partner"
```

---

### Task 7: Добавить модели Lead + LeadAttachment

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 7.1: Тест**

Создать `src/__tests__/schema.lead.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Lead, LeadAttachment } from '@prisma/client';

describe('Lead and LeadAttachment models', () => {
  it('Lead has client info, status, promotion linkage', () => {
    expectTypeOf<Lead>().toHaveProperty('partnerId');
    expectTypeOf<Lead>().toHaveProperty('createdByUserId');
    expectTypeOf<Lead>().toHaveProperty('clientCompanyName');
    expectTypeOf<Lead>().toHaveProperty('clientContactName');
    expectTypeOf<Lead>().toHaveProperty('subject');
    expectTypeOf<Lead>().toHaveProperty('estimatedAmount');
    expectTypeOf<Lead>().toHaveProperty('productType');
    expectTypeOf<Lead>().toHaveProperty('status');
    expectTypeOf<Lead>().toHaveProperty('promotedOrderId');
  });

  it('LeadAttachment has reference to lead and file metadata', () => {
    expectTypeOf<LeadAttachment>().toHaveProperty('leadId');
    expectTypeOf<LeadAttachment>().toHaveProperty('name');
    expectTypeOf<LeadAttachment>().toHaveProperty('path');
  });
});
```

- [ ] **Step 7.2: FAIL**

- [ ] **Step 7.3: Добавить модели**

```prisma
model Lead {
  id                  String     @id @default(cuid())
  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  partnerId           String
  partner             Partner    @relation(fields: [partnerId], references: [id])
  createdByUserId     String
  createdByUser       User       @relation("LeadAuthor", fields: [createdByUserId], references: [id])
  organizationId      String?
  organization        Organization? @relation(fields: [organizationId], references: [id])
  clientCompanyName   String
  clientInn           String?
  clientContactName   String
  clientContactPhone  String?
  clientContactEmail  String?
  subject             String
  estimatedAmount     Decimal?   @db.Decimal(14, 2)
  productType         String[]
  status              LeadStatus @default(new)
  assignedManagerId   String?
  assignedManager     User?      @relation("LeadManager", fields: [assignedManagerId], references: [id])
  promotedOrderId     String?    @unique
  promotedOrder       Order?     @relation("LeadPromoted", fields: [promotedOrderId], references: [id])
  rejectedReason      String?
  notes               String?
  attachments         LeadAttachment[]

  @@index([partnerId, status])
  @@index([assignedManagerId])
  @@index([createdAt])
}

model LeadAttachment {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id])
  name      String
  path      String
  mimeType  String
  size      Int

  @@index([leadId])
}
```

В `User { ... }` добавить relations:

```prisma
  leadsAuthored   Lead[] @relation("LeadAuthor")
  leadsManaged    Lead[] @relation("LeadManager")
```

- [ ] **Step 7.4: regenerate + тест PASS**

- [ ] **Step 7.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.lead.test.ts
git commit -m "feat(schema): add Lead + LeadAttachment models with promotion linkage"
```

---

### Task 8: Добавить CommissionStatement + CommissionStatementItem

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 8.1: Тест**

Создать `src/__tests__/schema.commission.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { CommissionStatement, CommissionStatementItem } from '@prisma/client';

describe('CommissionStatement and items', () => {
  it('statement has period, totals, status, pdf', () => {
    expectTypeOf<CommissionStatement>().toHaveProperty('partnerId');
    expectTypeOf<CommissionStatement>().toHaveProperty('periodFrom');
    expectTypeOf<CommissionStatement>().toHaveProperty('periodTo');
    expectTypeOf<CommissionStatement>().toHaveProperty('totalBaseAmount');
    expectTypeOf<CommissionStatement>().toHaveProperty('averageRate');
    expectTypeOf<CommissionStatement>().toHaveProperty('totalCommissionAmount');
    expectTypeOf<CommissionStatement>().toHaveProperty('status');
    expectTypeOf<CommissionStatement>().toHaveProperty('pdfPath');
    expectTypeOf<CommissionStatement>().toHaveProperty('supersededBy');
  });

  it('item ties statement ↔ order with snapshot values', () => {
    expectTypeOf<CommissionStatementItem>().toHaveProperty('statementId');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('orderId');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('orderNumber');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('organizationName');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('baseAmount');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('rate');
    expectTypeOf<CommissionStatementItem>().toHaveProperty('commissionAmount');
  });
});
```

- [ ] **Step 8.2: FAIL**

- [ ] **Step 8.3: Добавить модели**

```prisma
model CommissionStatement {
  id                     String                    @id @default(cuid())
  createdAt              DateTime                  @default(now())
  updatedAt              DateTime                  @updatedAt
  partnerId              String
  partner                Partner                   @relation(fields: [partnerId], references: [id])
  periodFrom             DateTime
  periodTo               DateTime
  calculatedAt           DateTime                  @default(now())
  calculatedByUserId     String?
  calculatedByUser       User?                     @relation("CommissionAuthor", fields: [calculatedByUserId], references: [id])
  totalBaseAmount        Decimal                   @default(0) @db.Decimal(14, 2)
  averageRate            Decimal                   @default(0) @db.Decimal(6, 4)
  totalCommissionAmount  Decimal                   @default(0) @db.Decimal(14, 2)
  status                 CommissionStatementStatus @default(draft)
  pdfPath                String?
  xlsxPath               String?
  approvedByUserId       String?
  approvedAt             DateTime?
  paidAt                 DateTime?
  supersededBy           String?
  notes                  String?
  items                  CommissionStatementItem[]

  @@index([partnerId, periodFrom, periodTo])
  @@index([status])
}

model CommissionStatementItem {
  id                String              @id @default(cuid())
  statementId       String
  statement         CommissionStatement @relation(fields: [statementId], references: [id])
  orderId           String
  order             Order               @relation(fields: [orderId], references: [id])
  orderNumber       String?
  organizationName  String
  baseAmount        Decimal             @db.Decimal(14, 2)
  rate              Decimal             @db.Decimal(6, 4)
  commissionAmount  Decimal             @db.Decimal(14, 2)

  @@index([statementId])
  @@index([orderId])
}
```

В `User` добавить relation:

```prisma
  commissionStatements CommissionStatement[] @relation("CommissionAuthor")
```

- [ ] **Step 8.4: regenerate + тест PASS**

- [ ] **Step 8.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.commission.test.ts
git commit -m "feat(schema): add CommissionStatement + Item with snapshot rates"
```

---

### Task 9: Добавить Payment

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 9.1: Тест**

Создать `src/__tests__/schema.payment.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { Payment } from '@prisma/client';

describe('Payment model', () => {
  it('has external linkage, amount, paid timestamp, refund flag', () => {
    expectTypeOf<Payment>().toHaveProperty('orderId');
    expectTypeOf<Payment>().toHaveProperty('externalId');
    expectTypeOf<Payment>().toHaveProperty('amount');
    expectTypeOf<Payment>().toHaveProperty('paidAt');
    expectTypeOf<Payment>().toHaveProperty('method');
    expectTypeOf<Payment>().toHaveProperty('isRefund');
  });
});
```

- [ ] **Step 9.2: FAIL**

- [ ] **Step 9.3: Добавить модель**

```prisma
model Payment {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  orderId     String
  order       Order    @relation(fields: [orderId], references: [id])
  externalId  String?  @unique
  amount      Decimal  @db.Decimal(14, 2)
  paidAt      DateTime
  method      String?
  isRefund    Boolean  @default(false)
  note        String?

  @@index([orderId])
  @@index([paidAt])
  @@index([externalId])
}
```

- [ ] **Step 9.4: regenerate + тест PASS**

- [ ] **Step 9.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.payment.test.ts
git commit -m "feat(schema): add Payment model for 1С payment sync"
```

---

### Task 10: Добавить SavedView

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 10.1: Тест**

Создать `src/__tests__/schema.savedView.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { SavedView } from '@prisma/client';

describe('SavedView model', () => {
  it('has scope, filters json, share flag', () => {
    expectTypeOf<SavedView>().toHaveProperty('userId');
    expectTypeOf<SavedView>().toHaveProperty('scope');
    expectTypeOf<SavedView>().toHaveProperty('name');
    expectTypeOf<SavedView>().toHaveProperty('filters');
    expectTypeOf<SavedView>().toHaveProperty('isDefault');
    expectTypeOf<SavedView>().toHaveProperty('isShared');
  });
});
```

- [ ] **Step 10.2: FAIL**

- [ ] **Step 10.3: Добавить**

```prisma
model SavedView {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  userId    String
  user      User     @relation("SavedViewOwner", fields: [userId], references: [id])
  scope     String
  name      String
  filters   Json
  isDefault Boolean  @default(false)
  isShared  Boolean  @default(false)

  @@index([userId, scope])
}
```

В `User`:

```prisma
  savedViews SavedView[] @relation("SavedViewOwner")
```

- [ ] **Step 10.4: regenerate + тест PASS**

- [ ] **Step 10.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.savedView.test.ts
git commit -m "feat(schema): add SavedView model for user filters"
```

---

### Task 11: Добавить SyncLog

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 11.1: Тест**

Создать `src/__tests__/schema.syncLog.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { SyncLog } from '@prisma/client';

describe('SyncLog model', () => {
  it('records entity, direction, operation, status, error, payload', () => {
    expectTypeOf<SyncLog>().toHaveProperty('entity');
    expectTypeOf<SyncLog>().toHaveProperty('externalId');
    expectTypeOf<SyncLog>().toHaveProperty('direction');
    expectTypeOf<SyncLog>().toHaveProperty('operation');
    expectTypeOf<SyncLog>().toHaveProperty('status');
    expectTypeOf<SyncLog>().toHaveProperty('errorMessage');
    expectTypeOf<SyncLog>().toHaveProperty('payload');
    expectTypeOf<SyncLog>().toHaveProperty('durationMs');
  });
});
```

- [ ] **Step 11.2: FAIL**

- [ ] **Step 11.3: Добавить**

```prisma
model SyncLog {
  id            String   @id @default(cuid())
  createdAt     DateTime @default(now())
  entity        String
  externalId    String?
  direction     String
  operation     String
  status        String
  errorMessage  String?
  payload       Json?
  durationMs    Int?

  @@index([entity, createdAt])
  @@index([status, createdAt])
}
```

- [ ] **Step 11.4: regenerate + тест PASS**

- [ ] **Step 11.5: Коммит**

```bash
git add prisma/schema.prisma src/__tests__/schema.syncLog.test.ts
git commit -m "feat(schema): add SyncLog model for 1С sync audit trail"
```

---

### Task 12: Сгенерировать миграцию

**Files:**
- Create: `prisma/migrations/<auto-named>/migration.sql`

- [ ] **Step 12.1: Создать миграцию**

```bash
npm run prisma:migrate -- --name partner_cabinet_phase0
# Prisma спросит — ответить "y" для применения
```

Prisma создаст папку вроде `prisma/migrations/20260521120000_partner_cabinet_phase0/migration.sql` с SQL DDL для всех изменений.

- [ ] **Step 12.2: Проверить SQL миграции на здравый смысл**

Открыть сгенерированный `migration.sql` и убедиться:
- Все 8 новых enum типов CREATE TYPE
- Все ALTER TABLE на существующие таблицы (Partner, Organization, Order, Document) не используют DROP без NULL safety
- Все 7 новых CREATE TABLE (PartnerUser, Lead, LeadAttachment, CommissionStatement, CommissionStatementItem, Payment, SavedView, SyncLog) присутствуют
- Индексы созданы

- [ ] **Step 12.3: Проверить, что предыдущие тесты всё ещё проходят**

```bash
npm test
# Ожидаемо: PASS все existing tests + новые 10 schema-тестов
```

- [ ] **Step 12.4: Коммит миграции**

```bash
git add prisma/migrations/
git commit -m "feat(db): apply partner cabinet phase 0 migration"
```

---

### Task 13: Smoke-тест Prisma client (integration)

**Files:**
- Create: `src/__tests__/schema.integration.test.ts`

- [ ] **Step 13.1: Написать integration тест**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase 0 schema integration', () => {
  it('can create a Partner with commissionRate and PartnerUser', async () => {
    const partner = await prisma.partner.create({
      data: {
        name: 'TestPartner-' + Date.now(),
        commissionRate: 0.1,
        legalName: 'ООО ТестПартнёр'
      }
    });

    expect(partner.commissionRate.toString()).toBe('0.1');

    // Создать User для PartnerUser
    const user = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.local`,
        passwordHash: 'fake',
        name: 'Test',
        role: 'partner'
      }
    });

    const pu = await prisma.partnerUser.create({
      data: {
        partnerId: partner.id,
        userId: user.id,
        roleInPartner: 'admin',
        assignedOrgIds: []
      }
    });

    expect(pu.roleInPartner).toBe('admin');

    // Cleanup
    await prisma.partnerUser.delete({ where: { id: pu.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
  });

  it('can create Lead with attachments and link to organization', async () => {
    const partner = await prisma.partner.create({
      data: { name: 'P-' + Date.now() }
    });
    const user = await prisma.user.create({
      data: {
        email: `lead-${Date.now()}@test.local`,
        passwordHash: 'x', name: 'L', role: 'partner'
      }
    });

    const lead = await prisma.lead.create({
      data: {
        partnerId: partner.id,
        createdByUserId: user.id,
        clientCompanyName: 'ООО Новый',
        clientContactName: 'Иванов',
        subject: 'Курс ОТ',
        productType: ['training'],
        status: 'new',
        attachments: {
          create: [
            { name: 'tz.pdf', path: 'leads/x/tz.pdf', mimeType: 'application/pdf', size: 1024 }
          ]
        }
      },
      include: { attachments: true }
    });

    expect(lead.attachments).toHaveLength(1);
    expect(lead.status).toBe('new');

    await prisma.lead.delete({ where: { id: lead.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.partner.delete({ where: { id: partner.id } });
  });
});
```

- [ ] **Step 13.2: Запустить — ожидаем PASS**

```bash
npx vitest run src/__tests__/schema.integration.test.ts
# Ожидаемо: PASS оба кейса
```

- [ ] **Step 13.3: Коммит**

```bash
git add src/__tests__/schema.integration.test.ts
git commit -m "test(schema): integration smoke for Partner, PartnerUser, Lead+attachments"
```

---

## Часть 2 — Инфраструктура: Redis + BullMQ

### Task 14: Добавить Redis в docker-compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 14.1: Расширить `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: cabinet
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d cabinet"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes:
  pgdata:
  redisdata:
```

- [ ] **Step 14.2: Добавить `REDIS_URL` в `.env.example`**

В конец `.env.example`:

```bash

# Redis для BullMQ (фоновые задачи, синхронизация с 1С)
REDIS_URL=redis://redis:6379
# Для локального запуска вне Docker:
# REDIS_URL=redis://localhost:6379
```

- [ ] **Step 14.3: Поднять Redis**

```bash
docker compose up -d redis
docker compose ps
# Ожидаемо: redis running (healthy)
```

- [ ] **Step 14.4: Проверить PING**

```bash
docker compose exec redis redis-cli ping
# Ожидаемо: PONG
```

- [ ] **Step 14.5: Коммит**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(infra): add Redis 7 to docker-compose for BullMQ"
```

---

### Task 15: Установить BullMQ + ioredis зависимости

**Files:**
- Modify: `package.json` (через npm install)

- [ ] **Step 15.1: Установить пакеты**

```bash
npm install bullmq@^5 ioredis@^5
npm install -D @types/ioredis@^5
```

- [ ] **Step 15.2: Проверить установку**

```bash
node -e "console.log(require('bullmq/package.json').version, require('ioredis/package.json').version)"
# Ожидаемо: 5.x.x 5.x.x
```

- [ ] **Step 15.3: Коммит**

```bash
git add package.json package-lock.json
git commit -m "chore: install bullmq and ioredis for background jobs"
```

---

### Task 16: Создать конфигурацию очередей

**Files:**
- Create: `src/lib/jobs/connection.ts`
- Create: `src/lib/jobs/queues.ts`
- Create: `src/lib/jobs/types.ts`

- [ ] **Step 16.1: Тест на парсинг REDIS_URL и регистрацию очередей**

Создать `src/__tests__/jobs.queues.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';

describe('Job queue registry', () => {
  it('declares all phase 0 queue names', () => {
    const expected: QueueName[] = [
      'oneCSync.pullOrders',
      'oneCSync.pullPayments',
      'oneCSync.pullDocuments',
      'oneCSync.pullOrganizations',
      'oneCSync.pushLead',
      'oneCSync.reconcile',
      'docs.generateCommissionPdf',
      'docs.generateCommissionXlsx',
      'notifications.dispatch',
      'emails.send'
    ];
    for (const name of expected) {
      expect(QUEUE_NAMES).toContain(name);
    }
  });
});
```

- [ ] **Step 16.2: FAIL (модуль не существует)**

```bash
npx vitest run src/__tests__/jobs.queues.test.ts
# FAIL: cannot find module
```

- [ ] **Step 16.3: Создать `src/lib/jobs/connection.ts`**

```typescript
import IORedis, { Redis } from 'ioredis';

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (connection) return connection;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
```

- [ ] **Step 16.4: Создать `src/lib/jobs/types.ts`**

```typescript
export type OneCEntity = 'order' | 'payment' | 'document' | 'organization' | 'lead';

export type SyncJobPayload = {
  triggeredAt: string;
  reason?: 'cron' | 'webhook' | 'manual';
};

export type PushLeadJobPayload = {
  leadId: string;
};

export type GenerateCommissionPdfPayload = {
  statementId: string;
};

export type NotificationDispatchPayload = {
  notificationId: string;
};

export type SendEmailPayload = {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, unknown>;
};
```

- [ ] **Step 16.5: Создать `src/lib/jobs/queues.ts`**

```typescript
import { Queue, type QueueOptions } from 'bullmq';
import { getRedisConnection } from './connection';

export const QUEUE_NAMES = [
  'oneCSync.pullOrders',
  'oneCSync.pullPayments',
  'oneCSync.pullDocuments',
  'oneCSync.pullOrganizations',
  'oneCSync.pushLead',
  'oneCSync.reconcile',
  'docs.generateCommissionPdf',
  'docs.generateCommissionXlsx',
  'notifications.dispatch',
  'emails.send'
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const defaultJobOpts: QueueOptions['defaultJobOptions'] = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions: defaultJobOpts
  });
  queues.set(name, queue);
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((q) => q.close()));
  queues.clear();
}
```

- [ ] **Step 16.6: Тест PASS**

```bash
npx vitest run src/__tests__/jobs.queues.test.ts
# Ожидаемо: PASS
```

- [ ] **Step 16.7: Коммит**

```bash
git add src/lib/jobs/ src/__tests__/jobs.queues.test.ts
git commit -m "feat(jobs): BullMQ queue registry with Redis connection"
```

---

### Task 17: Worker entrypoint со скелетом

**Files:**
- Create: `src/worker/index.ts`
- Create: `src/worker/processors/sync-orders.ts` (заглушка)
- Modify: `package.json` (npm scripts)

- [ ] **Step 17.1: Создать stub processor**

`src/worker/processors/sync-orders.ts`:

```typescript
import type { Job } from 'bullmq';
import type { SyncJobPayload } from '@/lib/jobs/types';

export async function syncOrdersProcessor(job: Job<SyncJobPayload>): Promise<{ ok: true }> {
  console.log('[worker] sync-orders job started', { id: job.id, payload: job.data });
  // TODO: вызвать pull() в Task 22 — пока заглушка
  return { ok: true };
}
```

- [ ] **Step 17.2: Создать `src/worker/index.ts`**

```typescript
import { Worker } from 'bullmq';
import { getRedisConnection, closeRedisConnection } from '@/lib/jobs/connection';
import { closeAllQueues } from '@/lib/jobs/queues';
import { syncOrdersProcessor } from './processors/sync-orders';

const workers: Worker[] = [];

function startWorker<T>(queueName: string, processor: (job: any) => Promise<T>): Worker {
  const worker = new Worker(queueName, processor, {
    connection: getRedisConnection(),
    autorun: true
  });
  worker.on('completed', (job) => {
    console.log(`[worker] ${queueName} completed`, { id: job.id });
  });
  worker.on('failed', (job, err) => {
    console.error(`[worker] ${queueName} failed`, { id: job?.id, error: err.message });
  });
  workers.push(worker);
  return worker;
}

async function main() {
  console.log('[worker] starting...');
  startWorker('oneCSync.pullOrders', syncOrdersProcessor);
  console.log('[worker] ready, listening on queues');
}

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  await Promise.all(workers.map((w) => w.close()));
  await closeAllQueues();
  await closeRedisConnection();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[worker] fatal error', err);
  process.exit(1);
});
```

- [ ] **Step 17.3: Добавить npm scripts в `package.json`**

В секции `scripts` добавить:

```json
{
  "scripts": {
    "...": "...",
    "worker": "tsx src/worker/index.ts",
    "worker:dev": "tsx watch src/worker/index.ts"
  }
}
```

- [ ] **Step 17.4: Smoke-тест воркера**

В одном терминале:
```bash
npm run worker:dev
# Ожидаемо: "[worker] starting..." затем "[worker] ready..."
```

В другом терминале:
```bash
node -e "
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const conn = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const q = new Queue('oneCSync.pullOrders', { connection: conn });
q.add('test', { triggeredAt: new Date().toISOString(), reason: 'manual' })
  .then((job) => { console.log('enqueued', job.id); return conn.quit(); });
"
```

Проверить в первом терминале — должно появиться `[worker] sync-orders job started` и `[worker] oneCSync.pullOrders completed`.

- [ ] **Step 17.5: Остановить воркер (Ctrl+C) и коммит**

```bash
git add src/worker/ package.json package-lock.json
git commit -m "feat(worker): BullMQ worker entrypoint with sync-orders stub"
```

---

## Часть 3 — Скелет 1С адаптера

### Task 18: OneCAdapter interface

**Files:**
- Create: `src/lib/services/oneCSync/adapter.ts`
- Create: `src/lib/services/oneCSync/dto.ts`

- [ ] **Step 18.1: Тест на форму interface**

Создать `src/__tests__/oneCSync.adapter.test.ts`:

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { OneCAdapter } from '@/lib/services/oneCSync/adapter';

describe('OneCAdapter interface', () => {
  it('exposes the four pull methods and one push', () => {
    expectTypeOf<OneCAdapter['pullOrders']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullPayments']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullDocuments']>().toBeFunction();
    expectTypeOf<OneCAdapter['pullOrganizations']>().toBeFunction();
    expectTypeOf<OneCAdapter['pushLead']>().toBeFunction();
  });
});
```

- [ ] **Step 18.2: FAIL (модуль не существует)**

- [ ] **Step 18.3: Создать `src/lib/services/oneCSync/dto.ts`**

```typescript
// DTO-типы, как их отдаёт 1С (без Prisma-зависимости)

export type OneCOrgDto = {
  externalId: string;
  name: string;
  legalName?: string;
  inn?: string;
  kpp?: string;
  partnerExternalId?: string;
  updatedAt: string; // ISO
};

export type OneCOrderDto = {
  externalId: string;
  orderNumber?: string;
  title: string;
  organizationExternalId: string;
  totalAmount: number;
  paidAmount: number;
  paidAt?: string;
  contractSignedAt?: string;
  completedAt?: string;
  closedAt?: string;
  vatIncluded: boolean;
  vatRate?: number;
  executionStatus: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'on_hold';
  financialStatus: 'not_billed' | 'billed' | 'partially_paid' | 'paid' | 'refunded';
  productMix: string[];
  updatedAt: string;
};

export type OneCPaymentDto = {
  externalId: string;
  orderExternalId: string;
  amount: number;
  paidAt: string;
  method?: string;
  isRefund: boolean;
  updatedAt: string;
};

export type OneCDocumentDto = {
  externalId: string;
  orderExternalId: string;
  type: 'contract' | 'extra_agreement' | 'invoice' | 'act' | 'waybill' | 'certificate' | 'report' | 'other';
  name: string;
  mimeType: string;
  size: number;
  signedAt?: string;
  downloadUrl: string;
  updatedAt: string;
};

export type OneCLeadPushPayload = {
  partnerExternalId?: string;
  partnerSlug?: string;
  cabinetLeadId: string;
  clientCompanyName: string;
  clientInn?: string;
  clientContactName: string;
  clientContactPhone?: string;
  clientContactEmail?: string;
  subject: string;
  estimatedAmount?: number;
  productType: string[];
  notes?: string;
};

export type OneCLeadPushResult = {
  acceptedAt: string;
  oneCRequestId?: string;
};

export type SyncCursor = {
  since?: string; // ISO timestamp
};
```

- [ ] **Step 18.4: Создать `src/lib/services/oneCSync/adapter.ts`**

```typescript
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushPayload,
  OneCLeadPushResult,
  SyncCursor
} from './dto';

export interface OneCAdapter {
  pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]>;
  pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]>;
  pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]>;
  pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]>;
  pushLead(payload: OneCLeadPushPayload): Promise<OneCLeadPushResult>;
}
```

- [ ] **Step 18.5: Тест PASS**

```bash
npx vitest run src/__tests__/oneCSync.adapter.test.ts
```

- [ ] **Step 18.6: Коммит**

```bash
git add src/lib/services/oneCSync/adapter.ts src/lib/services/oneCSync/dto.ts src/__tests__/oneCSync.adapter.test.ts
git commit -m "feat(1c-sync): OneCAdapter interface and DTO types"
```

---

### Task 19: Fake 1С адаптер с тестовыми данными

**Files:**
- Create: `src/lib/services/oneCSync/adapter-fake.ts`
- Create: `src/lib/services/oneCSync/fixtures/orders.ts`
- Create: `src/lib/services/oneCSync/fixtures/orgs.ts`

- [ ] **Step 19.1: Тест на fake-адаптер**

Создать `src/__tests__/oneCSync.adapter-fake.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';

describe('FakeOneCAdapter', () => {
  it('returns at least 3 organizations', async () => {
    const a = new FakeOneCAdapter();
    const orgs = await a.pullOrganizations({});
    expect(orgs.length).toBeGreaterThanOrEqual(3);
    expect(orgs[0]).toHaveProperty('externalId');
    expect(orgs[0]).toHaveProperty('name');
  });

  it('returns orders linked to organizations', async () => {
    const a = new FakeOneCAdapter();
    const orgs = await a.pullOrganizations({});
    const orders = await a.pullOrders({});
    const orgIds = new Set(orgs.map((o) => o.externalId));
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) {
      expect(orgIds.has(order.organizationExternalId)).toBe(true);
    }
  });

  it('respects cursor.since for incremental sync', async () => {
    const a = new FakeOneCAdapter();
    const all = await a.pullOrders({});
    const recent = await a.pullOrders({ since: '2050-01-01T00:00:00Z' });
    expect(recent.length).toBe(0);
    expect(all.length).toBeGreaterThan(recent.length);
  });

  it('pushLead returns acceptedAt timestamp', async () => {
    const a = new FakeOneCAdapter();
    const result = await a.pushLead({
      cabinetLeadId: 'lead-1',
      clientCompanyName: 'X',
      clientContactName: 'Y',
      subject: 'Z',
      productType: ['training']
    });
    expect(result.acceptedAt).toBeTruthy();
  });
});
```

- [ ] **Step 19.2: FAIL ожидаемо**

- [ ] **Step 19.3: Создать `src/lib/services/oneCSync/fixtures/orgs.ts`**

```typescript
import type { OneCOrgDto } from '../dto';

export const FAKE_ORGS: OneCOrgDto[] = [
  {
    externalId: '1c-org-001',
    name: 'ООО «Завод Прима»',
    legalName: 'Общество с ограниченной ответственностью «Завод Прима»',
    inn: '7701234567',
    kpp: '770101001',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-12T10:00:00Z'
  },
  {
    externalId: '1c-org-002',
    name: 'ОАО «Компас»',
    legalName: 'Открытое акционерное общество «Компас»',
    inn: '5024009999',
    kpp: '502401001',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-15T11:00:00Z'
  },
  {
    externalId: '1c-org-003',
    name: 'ЗАО «Энерго»',
    legalName: 'Закрытое акционерное общество «Энерго»',
    inn: '5030005555',
    kpp: '503001001',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-18T09:00:00Z'
  }
];
```

- [ ] **Step 19.4: Создать `src/lib/services/oneCSync/fixtures/orders.ts`**

```typescript
import type { OneCOrderDto, OneCPaymentDto, OneCDocumentDto } from '../dto';

export const FAKE_ORDERS: OneCOrderDto[] = [
  {
    externalId: '1c-order-1001',
    orderNumber: '2410-15',
    title: 'Курс ОТ для 12 сотрудников',
    organizationExternalId: '1c-org-001',
    totalAmount: 250000,
    paidAmount: 250000,
    paidAt: '2026-04-20T14:00:00Z',
    contractSignedAt: '2026-04-12T10:00:00Z',
    completedAt: '2026-05-10T18:00:00Z',
    closedAt: '2026-05-12T10:00:00Z',
    vatIncluded: true,
    vatRate: 0.2,
    executionStatus: 'completed',
    financialStatus: 'paid',
    productMix: ['training'],
    updatedAt: '2026-05-12T10:00:00Z'
  },
  {
    externalId: '1c-order-1002',
    orderNumber: '2410-16',
    title: 'Аудит промбезопасности',
    organizationExternalId: '1c-org-002',
    totalAmount: 480000,
    paidAmount: 240000,
    paidAt: '2026-04-25T14:00:00Z',
    contractSignedAt: '2026-04-15T11:00:00Z',
    vatIncluded: true,
    vatRate: 0.2,
    executionStatus: 'in_progress',
    financialStatus: 'partially_paid',
    productMix: ['service'],
    updatedAt: '2026-05-15T12:00:00Z'
  },
  {
    externalId: '1c-order-1003',
    orderNumber: '2410-17',
    title: 'Поставка оборудования + пусконаладка',
    organizationExternalId: '1c-org-003',
    totalAmount: 1200000,
    paidAmount: 1080000,
    paidAt: '2026-05-01T10:00:00Z',
    contractSignedAt: '2026-04-18T09:00:00Z',
    completedAt: '2026-05-05T16:00:00Z',
    vatIncluded: true,
    vatRate: 0.2,
    executionStatus: 'completed',
    financialStatus: 'partially_paid',
    productMix: ['supply', 'service'],
    updatedAt: '2026-05-05T16:00:00Z'
  }
];

export const FAKE_PAYMENTS: OneCPaymentDto[] = [
  {
    externalId: '1c-pay-001',
    orderExternalId: '1c-order-1001',
    amount: 250000,
    paidAt: '2026-04-20T14:00:00Z',
    method: 'wire',
    isRefund: false,
    updatedAt: '2026-04-20T14:00:00Z'
  },
  {
    externalId: '1c-pay-002',
    orderExternalId: '1c-order-1002',
    amount: 240000,
    paidAt: '2026-04-25T14:00:00Z',
    method: 'wire',
    isRefund: false,
    updatedAt: '2026-04-25T14:00:00Z'
  },
  {
    externalId: '1c-pay-003',
    orderExternalId: '1c-order-1003',
    amount: 1080000,
    paidAt: '2026-05-01T10:00:00Z',
    method: 'wire',
    isRefund: false,
    updatedAt: '2026-05-01T10:00:00Z'
  }
];

export const FAKE_DOCUMENTS: OneCDocumentDto[] = [
  {
    externalId: '1c-doc-1',
    orderExternalId: '1c-order-1001',
    type: 'contract',
    name: 'Договор 245.pdf',
    mimeType: 'application/pdf',
    size: 248_000,
    signedAt: '2026-04-12T10:00:00Z',
    downloadUrl: 'fake://1c-doc-1.pdf',
    updatedAt: '2026-04-12T10:00:00Z'
  },
  {
    externalId: '1c-doc-2',
    orderExternalId: '1c-order-1001',
    type: 'invoice',
    name: 'Счёт 1023.pdf',
    mimeType: 'application/pdf',
    size: 80_000,
    downloadUrl: 'fake://1c-doc-2.pdf',
    updatedAt: '2026-04-15T11:00:00Z'
  },
  {
    externalId: '1c-doc-3',
    orderExternalId: '1c-order-1001',
    type: 'act',
    name: 'Акт 401.pdf',
    mimeType: 'application/pdf',
    size: 120_000,
    signedAt: '2026-05-10T18:00:00Z',
    downloadUrl: 'fake://1c-doc-3.pdf',
    updatedAt: '2026-05-10T18:00:00Z'
  }
];
```

- [ ] **Step 19.5: Создать `src/lib/services/oneCSync/adapter-fake.ts`**

```typescript
import type { OneCAdapter } from './adapter';
import type {
  OneCOrgDto, OneCOrderDto, OneCPaymentDto, OneCDocumentDto,
  OneCLeadPushPayload, OneCLeadPushResult, SyncCursor
} from './dto';
import { FAKE_ORGS } from './fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from './fixtures/orders';

function afterCursor<T extends { updatedAt: string }>(items: T[], cursor: SyncCursor): T[] {
  if (!cursor.since) return items;
  const sinceTs = Date.parse(cursor.since);
  return items.filter((item) => Date.parse(item.updatedAt) > sinceTs);
}

export class FakeOneCAdapter implements OneCAdapter {
  async pullOrganizations(cursor: SyncCursor): Promise<OneCOrgDto[]> {
    return afterCursor(FAKE_ORGS, cursor);
  }

  async pullOrders(cursor: SyncCursor): Promise<OneCOrderDto[]> {
    return afterCursor(FAKE_ORDERS, cursor);
  }

  async pullPayments(cursor: SyncCursor): Promise<OneCPaymentDto[]> {
    return afterCursor(FAKE_PAYMENTS, cursor);
  }

  async pullDocuments(cursor: SyncCursor): Promise<OneCDocumentDto[]> {
    return afterCursor(FAKE_DOCUMENTS, cursor);
  }

  async pushLead(_payload: OneCLeadPushPayload): Promise<OneCLeadPushResult> {
    return {
      acceptedAt: new Date().toISOString(),
      oneCRequestId: `fake-req-${Date.now()}`
    };
  }
}
```

- [ ] **Step 19.6: Тест PASS**

```bash
npx vitest run src/__tests__/oneCSync.adapter-fake.test.ts
# Ожидаемо: PASS все 4 кейса
```

- [ ] **Step 19.7: Коммит**

```bash
git add src/lib/services/oneCSync/adapter-fake.ts src/lib/services/oneCSync/fixtures/ src/__tests__/oneCSync.adapter-fake.test.ts
git commit -m "feat(1c-sync): FakeOneCAdapter with realistic fixture data"
```

---

### Task 20: Adapter factory + env config

**Files:**
- Create: `src/lib/services/oneCSync/index.ts`
- Modify: `.env.example`

- [ ] **Step 20.1: Тест на factory**

Создать `src/__tests__/oneCSync.factory.test.ts`:

```typescript
import { describe, expect, it, afterEach } from 'vitest';
import { getOneCAdapter, resetOneCAdapter } from '@/lib/services/oneCSync';
import { FakeOneCAdapter } from '@/lib/services/oneCSync/adapter-fake';

describe('OneCAdapter factory', () => {
  afterEach(() => resetOneCAdapter());

  it('returns FakeOneCAdapter when ONE_C_ADAPTER=fake', () => {
    process.env.ONE_C_ADAPTER = 'fake';
    const adapter = getOneCAdapter();
    expect(adapter).toBeInstanceOf(FakeOneCAdapter);
  });

  it('returns FakeOneCAdapter by default when env unset', () => {
    delete process.env.ONE_C_ADAPTER;
    const adapter = getOneCAdapter();
    expect(adapter).toBeInstanceOf(FakeOneCAdapter);
  });

  it('throws when ONE_C_ADAPTER=rest until rest adapter exists', () => {
    process.env.ONE_C_ADAPTER = 'rest';
    expect(() => getOneCAdapter()).toThrow(/not implemented/i);
  });
});
```

- [ ] **Step 20.2: FAIL**

- [ ] **Step 20.3: Создать `src/lib/services/oneCSync/index.ts`**

```typescript
import type { OneCAdapter } from './adapter';
import { FakeOneCAdapter } from './adapter-fake';

let cached: OneCAdapter | null = null;

export function getOneCAdapter(): OneCAdapter {
  if (cached) return cached;
  const kind = (process.env.ONE_C_ADAPTER ?? 'fake').trim().toLowerCase();
  switch (kind) {
    case 'fake':
      cached = new FakeOneCAdapter();
      return cached;
    case 'rest':
      throw new Error('REST 1C adapter is not implemented yet (Phase 3)');
    case 'file':
      throw new Error('File 1C adapter is not implemented yet (Phase 3)');
    default:
      throw new Error(`Unknown ONE_C_ADAPTER value: ${kind}`);
  }
}

export function resetOneCAdapter(): void {
  cached = null;
}

export type { OneCAdapter } from './adapter';
export * from './dto';
```

- [ ] **Step 20.4: Добавить в `.env.example`**

В конец файла:

```bash

# 1С интеграция: fake (default — данные in-memory) | rest | file
ONE_C_ADAPTER=fake
# Для rest-адаптера в Фазе 3:
# ONE_C_API_URL=https://1c.example.com/api
# ONE_C_API_TOKEN=replace_with_token
```

- [ ] **Step 20.5: Тест PASS**

```bash
npx vitest run src/__tests__/oneCSync.factory.test.ts
```

- [ ] **Step 20.6: Коммит**

```bash
git add src/lib/services/oneCSync/index.ts .env.example src/__tests__/oneCSync.factory.test.ts
git commit -m "feat(1c-sync): adapter factory keyed by ONE_C_ADAPTER env"
```

---

### Task 21: SyncLog helper

**Files:**
- Create: `src/lib/services/oneCSync/log.ts`

- [ ] **Step 21.1: Тест**

Создать `src/__tests__/oneCSync.log.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient();
});
afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(async () => {
  await prisma.syncLog.deleteMany({
    where: { entity: 'order', externalId: { startsWith: 'log-test-' } }
  });
});

describe('writeSyncLog', () => {
  it('persists a success record', async () => {
    await writeSyncLog({
      entity: 'order',
      externalId: 'log-test-1',
      direction: 'inbound',
      operation: 'create',
      status: 'success',
      durationMs: 12
    });
    const rows = await prisma.syncLog.findMany({
      where: { externalId: 'log-test-1' }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('success');
  });

  it('persists an error with message and payload', async () => {
    await writeSyncLog({
      entity: 'order',
      externalId: 'log-test-2',
      direction: 'inbound',
      operation: 'update',
      status: 'error',
      errorMessage: 'boom',
      payload: { stack: 'fake' }
    });
    const row = await prisma.syncLog.findFirst({
      where: { externalId: 'log-test-2' }
    });
    expect(row?.errorMessage).toBe('boom');
    expect(row?.payload).toMatchObject({ stack: 'fake' });
  });
});
```

- [ ] **Step 21.2: FAIL**

- [ ] **Step 21.3: Создать `src/lib/services/oneCSync/log.ts`**

```typescript
import { prisma } from '@/lib/db/prisma';

export type SyncLogEntry = {
  entity: 'order' | 'payment' | 'document' | 'organization' | 'lead';
  externalId?: string;
  direction: 'inbound' | 'outbound';
  operation: 'create' | 'update' | 'skip' | 'delete';
  status: 'success' | 'error' | 'warn';
  errorMessage?: string;
  payload?: unknown;
  durationMs?: number;
};

export async function writeSyncLog(entry: SyncLogEntry): Promise<void> {
  await prisma.syncLog.create({
    data: {
      entity: entry.entity,
      externalId: entry.externalId ?? null,
      direction: entry.direction,
      operation: entry.operation,
      status: entry.status,
      errorMessage: entry.errorMessage ?? null,
      payload: (entry.payload as object) ?? undefined,
      durationMs: entry.durationMs ?? null
    }
  });
}
```

- [ ] **Step 21.4: Тест PASS**

```bash
npx vitest run src/__tests__/oneCSync.log.test.ts
```

- [ ] **Step 21.5: Коммит**

```bash
git add src/lib/services/oneCSync/log.ts src/__tests__/oneCSync.log.test.ts
git commit -m "feat(1c-sync): writeSyncLog helper for sync audit trail"
```

---

### Task 22: Mappers — 1С DTO → Prisma upsert payload

**Files:**
- Create: `src/lib/services/oneCSync/mappers.ts`

- [ ] **Step 22.1: Тест**

Создать `src/__tests__/oneCSync.mappers.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  mapOrgDto,
  mapOrderDto,
  mapPaymentDto,
  mapDocumentDto
} from '@/lib/services/oneCSync/mappers';

describe('1C → Prisma mappers', () => {
  it('mapOrgDto produces Prisma upsert input shape', () => {
    const input = {
      externalId: '1c-org-001',
      name: 'ООО Тест',
      legalName: 'Test LLC',
      inn: '770000',
      kpp: '770001',
      partnerExternalId: '1c-partner-001',
      updatedAt: '2026-05-01T00:00:00Z'
    };
    const out = mapOrgDto(input);
    expect(out.externalId).toBe('1c-org-001');
    expect(out.name).toBe('ООО Тест');
    expect(out.inn).toBe('770000');
  });

  it('mapOrderDto carries enums and decimals as strings/numbers', () => {
    const input = {
      externalId: '1c-order-1',
      orderNumber: 'N-1',
      title: 'T',
      organizationExternalId: '1c-org-001',
      totalAmount: 100,
      paidAmount: 50,
      paidAt: '2026-05-01T00:00:00Z',
      vatIncluded: true,
      vatRate: 0.2,
      executionStatus: 'in_progress' as const,
      financialStatus: 'partially_paid' as const,
      productMix: ['training'],
      updatedAt: '2026-05-01T00:00:00Z'
    };
    const out = mapOrderDto(input);
    expect(out.externalId).toBe('1c-order-1');
    expect(out.executionStatus).toBe('in_progress');
    expect(out.financialStatus).toBe('partially_paid');
    expect(out.totalAmount).toBe(100);
    expect(out.productMix).toEqual(['training']);
  });

  it('mapPaymentDto preserves orderExternalId for later resolution', () => {
    const out = mapPaymentDto({
      externalId: 'p1',
      orderExternalId: 'o1',
      amount: 50,
      paidAt: '2026-05-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('p1');
    expect(out.orderExternalId).toBe('o1');
    expect(out.amount).toBe(50);
  });

  it('mapDocumentDto preserves type as enum-compatible string', () => {
    const out = mapDocumentDto({
      externalId: 'd1',
      orderExternalId: 'o1',
      type: 'act',
      name: 'Акт.pdf',
      mimeType: 'application/pdf',
      size: 100,
      downloadUrl: 'fake://d1',
      updatedAt: '2026-05-01T00:00:00Z'
    });
    expect(out.externalId).toBe('d1');
    expect(out.type).toBe('act');
  });
});
```

- [ ] **Step 22.2: FAIL**

- [ ] **Step 22.3: Создать `src/lib/services/oneCSync/mappers.ts`**

```typescript
import type {
  OneCOrgDto, OneCOrderDto, OneCPaymentDto, OneCDocumentDto
} from './dto';
import type {
  ExecutionStatus, FinancialStatus, DocumentType
} from '@prisma/client';

export type OrgUpsertInput = {
  externalId: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  partnerExternalId: string | null;
  updatedAt: Date;
};

export function mapOrgDto(dto: OneCOrgDto): OrgUpsertInput {
  return {
    externalId: dto.externalId,
    name: dto.name,
    inn: dto.inn ?? null,
    kpp: dto.kpp ?? null,
    partnerExternalId: dto.partnerExternalId ?? null,
    updatedAt: new Date(dto.updatedAt)
  };
}

export type OrderUpsertInput = {
  externalId: string;
  orderNumber: string | null;
  title: string;
  organizationExternalId: string;
  totalAmount: number;
  paidAmount: number;
  paidAt: Date | null;
  contractSignedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  vatIncluded: boolean;
  vatRate: number | null;
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  productMix: string[];
  updatedAt: Date;
};

export function mapOrderDto(dto: OneCOrderDto): OrderUpsertInput {
  return {
    externalId: dto.externalId,
    orderNumber: dto.orderNumber ?? null,
    title: dto.title,
    organizationExternalId: dto.organizationExternalId,
    totalAmount: dto.totalAmount,
    paidAmount: dto.paidAmount,
    paidAt: dto.paidAt ? new Date(dto.paidAt) : null,
    contractSignedAt: dto.contractSignedAt ? new Date(dto.contractSignedAt) : null,
    completedAt: dto.completedAt ? new Date(dto.completedAt) : null,
    closedAt: dto.closedAt ? new Date(dto.closedAt) : null,
    vatIncluded: dto.vatIncluded,
    vatRate: dto.vatRate ?? null,
    executionStatus: dto.executionStatus as ExecutionStatus,
    financialStatus: dto.financialStatus as FinancialStatus,
    productMix: dto.productMix,
    updatedAt: new Date(dto.updatedAt)
  };
}

export type PaymentUpsertInput = {
  externalId: string;
  orderExternalId: string;
  amount: number;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  updatedAt: Date;
};

export function mapPaymentDto(dto: OneCPaymentDto): PaymentUpsertInput {
  return {
    externalId: dto.externalId,
    orderExternalId: dto.orderExternalId,
    amount: dto.amount,
    paidAt: new Date(dto.paidAt),
    method: dto.method ?? null,
    isRefund: dto.isRefund,
    updatedAt: new Date(dto.updatedAt)
  };
}

export type DocumentUpsertInput = {
  externalId: string;
  orderExternalId: string;
  type: DocumentType;
  name: string;
  mimeType: string;
  size: number;
  signedAt: Date | null;
  downloadUrl: string;
  updatedAt: Date;
};

export function mapDocumentDto(dto: OneCDocumentDto): DocumentUpsertInput {
  return {
    externalId: dto.externalId,
    orderExternalId: dto.orderExternalId,
    type: dto.type as DocumentType,
    name: dto.name,
    mimeType: dto.mimeType,
    size: dto.size,
    signedAt: dto.signedAt ? new Date(dto.signedAt) : null,
    downloadUrl: dto.downloadUrl,
    updatedAt: new Date(dto.updatedAt)
  };
}
```

- [ ] **Step 22.4: Тест PASS**

```bash
npx vitest run src/__tests__/oneCSync.mappers.test.ts
```

- [ ] **Step 22.5: Коммит**

```bash
git add src/lib/services/oneCSync/mappers.ts src/__tests__/oneCSync.mappers.test.ts
git commit -m "feat(1c-sync): mappers from 1С DTOs to Prisma upsert inputs"
```

---

## Часть 4 — Deliverables и финал

### Task 23: Документ контракта интеграции с IT 1С

**Files:**
- Create: `docs/integrations/1c-contract.md`

- [ ] **Step 23.1: Создать документ**

```markdown
# Контракт интеграции с 1С — Партнёрский кабинет

**Дата:** 2026-05-21
**Версия:** 0.1 (Draft — для согласования с IT 1С)
**Связано:** Phase 0 партнёрского кабинета

## Цель

Документ фиксирует требования к API/интерфейсу 1С со стороны кабинета. Без согласования и реализации со стороны IT 1С Фаза 3 (включение реального 1С) невозможна.

## Запрашиваемые операции

### 1. GET Organizations (Контрагенты)

`GET /api/organizations?since=ISO_TS`

Возвращает контрагентов, у которых дата последнего изменения > `since`.

Response (JSON массив):
```json
[{
  "externalId": "string (GUID или внутр. ID 1С)",
  "name": "ООО Завод",
  "legalName": "...",
  "inn": "770000",
  "kpp": "770001",
  "partnerExternalId": "string (ID партнёра в 1С)",
  "updatedAt": "2026-05-01T10:00:00Z"
}]
```

### 2. GET Orders (Реализации/Сделки)

`GET /api/orders?since=ISO_TS`

```json
[{
  "externalId": "string",
  "orderNumber": "2410-15",
  "title": "Краткое описание",
  "organizationExternalId": "...",
  "totalAmount": 250000,
  "paidAmount": 250000,
  "paidAt": "2026-04-20T14:00:00Z",
  "contractSignedAt": "2026-04-12T10:00:00Z",
  "completedAt": "2026-05-10T18:00:00Z",
  "closedAt": "2026-05-12T10:00:00Z",
  "vatIncluded": true,
  "vatRate": 0.2,
  "executionStatus": "pending|in_progress|completed|cancelled|on_hold",
  "financialStatus": "not_billed|billed|partially_paid|paid|refunded",
  "productMix": ["training", "service", "supply"],
  "updatedAt": "2026-05-12T10:00:00Z"
}]
```

### 3. GET Payments (Поступления)

`GET /api/payments?since=ISO_TS`

```json
[{
  "externalId": "...",
  "orderExternalId": "...",
  "amount": 250000,
  "paidAt": "2026-04-20T14:00:00Z",
  "method": "wire|card|cash",
  "isRefund": false,
  "updatedAt": "2026-04-20T14:00:00Z"
}]
```

### 4. GET Documents (Файлы по сделкам)

`GET /api/documents?since=ISO_TS`

```json
[{
  "externalId": "...",
  "orderExternalId": "...",
  "type": "contract|extra_agreement|invoice|act|waybill|certificate|report|other",
  "name": "Договор 245.pdf",
  "mimeType": "application/pdf",
  "size": 248000,
  "signedAt": "2026-04-12T10:00:00Z",
  "downloadUrl": "https://1c.example.com/files/abc123",
  "updatedAt": "2026-04-12T10:00:00Z"
}]
```

`downloadUrl` должен:
- Быть подписанным (signed URL с TTL ≥ 5 мин), либо
- Использовать Bearer-токен в Authorization header.

### 5. POST Lead (Заявка от партнёра в 1С)

`POST /api/leads`

```json
{
  "partnerExternalId": "...",
  "cabinetLeadId": "cuid",
  "clientCompanyName": "...",
  "clientInn": "...",
  "clientContactName": "...",
  "clientContactPhone": "...",
  "clientContactEmail": "...",
  "subject": "...",
  "estimatedAmount": 100000,
  "productType": ["training"],
  "notes": "..."
}
```

Response:
```json
{
  "acceptedAt": "2026-05-21T10:00:00Z",
  "oneCRequestId": "..."
}
```

## Аутентификация

Один из вариантов на выбор IT 1С:
- Bearer token в header (предпочтительно)
- Mutual TLS
- IP-allowlist + basic auth

## Идемпотентность

Кабинет может повторно запрашивать тот же `since` (например, после рестарта). 1С должна возвращать стабильные `externalId` — повторные запросы не должны порождать «дубли с другим ID».

## Расписание запросов

Кабинет будет опрашивать с частотой:
- Orders: каждые 15 мин
- Payments: каждые 15 мин
- Documents: каждый час
- Organizations: каждые 6 часов
- Reconcile (полный с last 30 дней): раз в сутки в 03:00

Если 1С может **push-ить webhook** — фиксируем endpoint:
`POST {cabinet_url}/api/integrations/1c/webhook`
- Auth: HMAC-signature header `X-1C-Signature` (SHA-256 от body с shared secret)

## Открытые вопросы

- [ ] Какой именно интерфейс отдаёт 1С: HTTP-сервисы (REST), OData, CommerceML, файловые выгрузки?
- [ ] Domain/URL продукционной 1С
- [ ] IP-адреса для allowlist (production кабинета)
- [ ] Лимиты API (rate limits): запросов в минуту
- [ ] Структура «партнёра» в 1С — есть ли поле «партнёр» на контрагенте/реализации, или маппинг через справочник?
- [ ] TZ и формат datetime в API (UTC ISO 8601?)
- [ ] Идентификация партнёра при push-leads (`partnerExternalId` или `partnerSlug` — что в 1С первичный ключ?)
- [ ] Может ли 1С отдавать `since`-курсор по timestamp, или только полные выгрузки?
- [ ] Какие статусы есть в 1С и как они мапятся в наши `executionStatus`/`financialStatus`?

## Стейкхолдеры

- [ ] IT 1С — реализация эндпоинтов
- [ ] Бухгалтерия — валидация маппинга статусов и документов
- [ ] PM партнёрского кабинета — приёмка
```

- [ ] **Step 23.2: Коммит**

```bash
git add docs/integrations/1c-contract.md
git commit -m "docs(1c): integration contract draft for IT discussions"
```

---

### Task 24: Wire fake-pull в worker (smoke end-to-end)

**Files:**
- Modify: `src/worker/processors/sync-orders.ts`

- [ ] **Step 24.1: Тест на end-to-end smoke**

Создать `src/__tests__/worker.sync-orders.smoke.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { resetOneCAdapter } from '@/lib/services/oneCSync';

beforeAll(() => {
  process.env.ONE_C_ADAPTER = 'fake';
  resetOneCAdapter();
});

afterAll(() => {
  resetOneCAdapter();
});

describe('sync-orders processor smoke', () => {
  it('returns count of pulled orders from fake adapter', async () => {
    const job = {
      id: 'test-1',
      data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const }
    };
    const result = await syncOrdersProcessor(job as any);
    expect(result.pulled).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 24.2: FAIL — текущий processor возвращает `{ok:true}`, не `pulled`**

- [ ] **Step 24.3: Расширить `src/worker/processors/sync-orders.ts`**

```typescript
import type { Job } from 'bullmq';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type SyncOrdersResult = {
  pulled: number;
};

export async function syncOrdersProcessor(
  job: Job<SyncJobPayload>
): Promise<SyncOrdersResult> {
  const startedAt = Date.now();
  console.log('[worker] sync-orders job started', { id: job.id });
  try {
    const adapter = getOneCAdapter();
    const orders = await adapter.pullOrders({});
    // TODO в Phase 3: upsert в БД через mappers + конфликт-резолв
    await writeSyncLog({
      entity: 'order',
      direction: 'inbound',
      operation: 'skip',
      status: 'success',
      payload: { pulled: orders.length, note: 'no upsert in phase 0' },
      durationMs: Date.now() - startedAt
    });
    return { pulled: orders.length };
  } catch (err) {
    await writeSyncLog({
      entity: 'order',
      direction: 'inbound',
      operation: 'skip',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt
    });
    throw err;
  }
}
```

- [ ] **Step 24.4: Тест PASS**

```bash
npx vitest run src/__tests__/worker.sync-orders.smoke.test.ts
```

- [ ] **Step 24.5: Коммит**

```bash
git add src/worker/processors/sync-orders.ts src/__tests__/worker.sync-orders.smoke.test.ts
git commit -m "feat(worker): wire fake adapter pull into sync-orders with logging"
```

---

### Task 25: Финальный smoke — полный прогон тестов и build

**Files:** — никаких новых; только проверка состояния

- [ ] **Step 25.1: Полный прогон тестов**

```bash
npm test
# Ожидаемо: все тесты PASS (существующие + ~15 новых из Phase 0)
```

- [ ] **Step 25.2: Type check**

```bash
npm run typecheck
# Ожидаемо: 0 ошибок
```

- [ ] **Step 25.3: Lint**

```bash
npm run lint
# Ожидаемо: 0 ошибок
```

- [ ] **Step 25.4: Production build (Next.js)**

```bash
npm run build
# Ожидаемо: успешная сборка
```

- [ ] **Step 25.5: Запуск worker (smoke в реальном Redis)**

В одном терминале:
```bash
npm run worker
```

В другом — enqueue job:
```bash
node -e "
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const conn = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
const q = new Queue('oneCSync.pullOrders', { connection: conn });
q.add('smoke', { triggeredAt: new Date().toISOString(), reason: 'manual' })
  .then(j => { console.log('enq', j.id); return conn.quit(); });
"
```

В терминале воркера должны увидеть:
- `[worker] sync-orders job started`
- `[worker] oneCSync.pullOrders completed`

Проверить запись в БД:
```bash
docker compose exec db psql -U postgres -d cabinet -c "SELECT entity, status, payload FROM \"SyncLog\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

Ожидаемо: одна свежая запись `order/success/{pulled: 3}`.

- [ ] **Step 25.6: Коммит финального state-файла**

Создать `docs/superpowers/plans/2026-05-21-partner-cabinet-phase0-DONE.md`:

```markdown
# Phase 0 — DONE

Дата завершения: <today>
Hash коммита базы: <git rev-parse HEAD>

## Что готово
- Расширенная Prisma-схема (8 enums, 5 расширенных моделей, 7 новых)
- Миграция применена
- Redis + BullMQ инфраструктура (worker процесс)
- OneCAdapter pattern с fake-реализацией
- SyncLog аудит
- End-to-end smoke: worker → fake adapter → SyncLog запись
- 1С contract draft для IT

## Что НЕ готово (по плану — следующие фазы)
- UI партнёрского кабинета (Phase 1)
- Реальный 1С (Phase 3)
- Расчёт комиссии (Phase 4)
- Лиды UI (Phase 2)
```

```bash
git add docs/superpowers/plans/2026-05-21-partner-cabinet-phase0-DONE.md
git commit -m "chore(phase0): mark foundation phase complete"
```

---

## Что дальше — outline следующих фаз

Каждая последующая фаза получит **свой детальный план** перед стартом. Ниже — high-level каркас.

### Phase 1 — Каркас партнёра (2 недели)

**Файлы для создания/изменения:**

- `src/app/partner/portfolio/page.tsx` — список организаций (Server Component, server-side filter+pagination)
- `src/app/partner/portfolio/[orgId]/page.tsx` — карточка организации
- `src/app/partner/portfolio/[orgId]/documents/page.tsx` — табы документов
- `src/app/partner/team/page.tsx` — управление командой партнёра (admin only)
- `src/app/api/partner-team/route.ts` — CRUD PartnerUser
- `src/lib/auth/partner.ts` — guard `getCurrentPartnerUser()`, проверка scope `assignedOrgIds`
- `src/lib/services/partnerPortfolio.ts` — `listOrganizationsForPartner(partnerId, filters)`
- Расширение `src/lib/auth/access.ts` — partner admin sub-role check
- Расширение `src/middleware.ts` — защита `/partner/team`
- Компоненты: `PartnerOrgsTable.tsx`, `PartnerOrgsCardList.tsx` (mobile), `PartnerOrgCard.tsx`

**Тесты:** RBAC partner scope, server-side pagination, sort, фильтры, mobile vs desktop view switch.

### Phase 2 — Сделки и документы (2 недели)

- `src/app/partner/deals/page.tsx`, `.../[id]/page.tsx`
- `src/app/partner/documents/page.tsx` (глобальный список)
- `src/lib/orders/humanStage.ts` — helper для лейбла из `(executionStatus, financialStatus)`
- `src/lib/services/dealList.ts`, `src/lib/services/documentList.ts`
- Расширение `src/app/api/orders/route.ts` — фильтры по двухмерному статусу
- Компоненты: `DealStatusBadge.tsx`, `DealsTable.tsx`, `DealsCardList.tsx`, `DocumentsList.tsx`, `DocumentPreview.tsx`
- BullMQ jobs: `oneCSync.pullOrders/pullPayments/pullDocuments` — полная реализация с upsert через mappers (но всё ещё с fake-адаптером)

**Тесты:** `humanStage` golden test (12+ кейсов), idempotency upsert при повторном pull.

### Phase 3 — Реальный 1С (2 недели)

- `src/lib/services/oneCSync/adapter-rest.ts` — REST реализация
- `src/lib/services/oneCSync/conflict.ts` — правила конфликт-резолва (поля владения)
- `src/app/api/integrations/1c/webhook/route.ts` — HMAC + IP allowlist
- `src/app/api/integrations/1c/health/route.ts` — health endpoint для мониторинга
- `src/app/admin/integrations/page.tsx` — дашборд SyncLog для админа
- Reconcile job полностью реализован
- `src/app/partner/leads/*` UI
- `src/app/api/leads/route.ts` CRUD
- `oneCSync.pushLead` job — promote lead → 1С

**Тесты:** HMAC валидация, IP-allowlist, конфликт-резолв (поля кабинета не перетираются), reconcile полнота.

### Phase 4 — Финансы и комиссия (2 недели)

- `src/lib/services/commission.ts` — алгоритм расчёта с per-org override
- `src/app/api/commission-statements/route.ts` — CRUD
- `src/app/partner/finance/page.tsx`, `.../[statementId]/page.tsx`
- `src/lib/services/pdfGen/commission.tsx` — react-pdf шаблон
- `src/lib/services/xlsxGen/commission.ts` — exceljs
- BullMQ jobs: `docs.generateCommissionPdf`, `docs.generateCommissionXlsx`
- Per-org rate override UI на карточке организации (admin партнёра)
- Уведомление о готовности расчёта

**Тесты:** commission golden test с 10 заказами и mixed rates, PDF render snapshot, audit log per-org rate change.

### Phase 5 — Полировка и масштаб (2 недели)

- PWA manifest (`public/manifest.json`, service worker для offline)
- Saved views (URL-state + persistence в `SavedView`)
- Bulk-экспорт Excel (`/partner/deals?export=xlsx`)
- Dashboard «Требует внимания» (виджеты)
- Performance: индексы (мониторинг slow queries), курсорная пагинация для большого портфеля
- Feature flags через env (`FEATURE_*`)
- Documentation: user guide для партнёра, runbook для админа

**Тесты:** Lighthouse mobile score ≥ 85, load test 1000 заказов, saved-view URL sharing.

---

## Self-Review

Прогнал свежим взглядом против спеца:

**1. Покрытие спеца:**
- ✅ Все 8 enums из спеца (раздел 3.1) — Task 1
- ✅ Расширения 5 моделей (Partner, Organization, Order, Document) — Tasks 2-5
- ✅ Document.uploadedById nullable — Task 5
- ✅ Все 7 новых моделей — Tasks 6-11
- ✅ Migration — Task 12
- ✅ Smoke integration — Task 13
- ✅ Redis + BullMQ — Tasks 14-17
- ✅ OneCAdapter pattern (interface + fake) — Tasks 18-19, 20
- ✅ SyncLog — Task 21
- ✅ Mappers — Task 22
- ✅ 1С contract документ — Task 23
- ✅ End-to-end smoke — Task 24
- ✅ Финальный verify — Task 25
- ⏭ UI / 1С rest / commission / finance — отложено на Phases 1-5 (по плану спеца)
- ⏭ NotificationType конвертация существующего поля — намеренно отложил миграцию данных на Phase 2, когда будут реальные нотификации

**2. Placeholders:** TODO в коде есть только в processor (`// TODO в Phase 3: upsert в БД через mappers`) — это намеренный stub, который раскрывается в Phase 2. Никаких других TBD/TODO.

**3. Type consistency:**
- `ExecutionStatus`, `FinancialStatus`, `DocumentType` — одно и то же название в enum, dto, mappers
- `OneCAdapter` interface методы (`pullOrders`, `pullPayments`, ...) — те же имена в fake и в factory
- `writeSyncLog` принимает `SyncLogEntry` — `entity` совпадает с union в `SyncLog.entity`
- `QUEUE_NAMES` константа — те же строки в worker `startWorker(name, ...)`

Issues найдены и исправлены inline.

---

## Заметки для исполнителя

- **Прагматичный Service Layer** (из спеца): не создавайте сервис для каждой модели. Сервисы только там, где есть логика — в Phase 0 это `oneCSync/*`. Простые read-операции в следующих фазах будут идти прямо из Server Components.
- **Не оптимизируйте преждевременно.** Если индекс не используется в первой версии запроса — пусть будет, но без жёсткой проверки в тестах. Перформанс-тесты делаются в Phase 5.
- **Атомарность миграции.** Все Prisma-изменения попадают в **одну** миграцию (Task 12). Не дробите её на 10 мелких — Prisma это плохо переносит при rollback.
- **Тесты гоняйте с свежей `prisma generate`.** Если меняли схему — `npm run prisma:generate` перед `npm test`, иначе типы будут устаревшими.
- **Git identity** — настройте локально (Pre-1), не глобально. Никаких `git config --global`.
- **Worker не закидывайте в production-сборку Next.js.** Это отдельный процесс. Если деплой через Docker — отдельный image или второй entrypoint.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-partner-cabinet-phase0.md`.**

Две опции выполнения:

**1. Subagent-Driven (рекомендую для проекта такого размера)** — диспатчу свежий subagent на каждую задачу (или группу из 2-3 задач), ревью между задачами, быстрая итерация. Хорошо защищает контекст основного диалога.

**2. Inline Execution** — выполняем задачи прямо в этой сессии, batch-исполнение с чекпоинтами для ревью. Проще, но контекст «забивается» кодом.

**Какой подход?**
