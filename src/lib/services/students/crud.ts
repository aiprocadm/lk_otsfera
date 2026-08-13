import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { studentOrgAccess } from './access';
import { findDuplicates, type DuplicateCandidate, type DuplicateMatch } from './duplicates';

/**
 * Справочник сотрудников (`У-23`, этап 5 ТЗ понятности).
 *
 * До этапа сотрудника нельзя было создать **нигде**: `student.create(` не
 * вызывался ни в одном месте кода, записи появлялись только из сидов и импорта
 * 1С. Из-за этого заявку на обучение нельзя было подать на нового человека.
 *
 * Контракт — стабильный Result (CLAUDE.md §3), права — в сервисе (§4).
 */
export type StudentError =
  'forbidden' | 'not_found' | 'validation' | 'duplicate_found' | 'org_not_found';

export type StudentInput = {
  name: string;
  position?: string | null;
  snils?: string | null;
  birthDate?: Date | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
};

export type CreateStudentResult =
  | { ok: true; id: string }
  | { ok: false; error: 'duplicate_found'; match: DuplicateMatch; candidates: DuplicateCandidate[] }
  | { ok: false; error: Exclude<StudentError, 'duplicate_found'>; messages?: string[] };

function clean(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

/** ФИО — единственное обязательное поле (`У-27`). Остальное заполняется потом. */
function validate(input: StudentInput): { ok: true } | { ok: false; messages: string[] } {
  const messages: string[] = [];
  if (!clean(input.name)) messages.push('Укажите ФИО сотрудника');
  const snils = clean(input.snils);
  if (snils && snils.replace(/\D/g, '').length !== 11) {
    messages.push('СНИЛС должен содержать 11 цифр');
  }
  const email = clean(input.email);
  if (email && !email.includes('@')) messages.push('Почта указана неверно');
  return messages.length > 0 ? { ok: false, messages } : { ok: true };
}

function data(input: StudentInput) {
  return {
    // `?? ''` недостижимо: сюда попадают только входы, прошедшие `validate`,
    // а он не пускает пустое имя. Оставлено, чтобы тип поля оставался string.
    /* v8 ignore next */
    name: clean(input.name) ?? '',
    position: clean(input.position),
    snils: clean(input.snils),
    birthDate: input.birthDate ?? null,
    email: clean(input.email),
    phone: clean(input.phone),
    note: clean(input.note),
  };
}

export async function createStudent(
  prisma: PrismaClient,
  session: SessionPayload,
  args: StudentInput & {
    organizationId: string;
    teamMode: boolean;
    /** «Всё равно добавить» — оператор увидел дубль и настоял (`У-22`). */
    force?: boolean;
  }
): Promise<CreateStudentResult> {
  const access = await studentOrgAccess(prisma, session, args.organizationId, args.teamMode);
  if (!access.canWrite) return { ok: false, error: 'forbidden' };

  const valid = validate(args);
  if (!valid.ok) return { ok: false, error: 'validation', messages: valid.messages };

  if (!args.force) {
    const dup = await findDuplicates(prisma, {
      organizationId: args.organizationId,
      name: args.name,
      snils: args.snils ?? null,
      birthDate: args.birthDate ?? null,
      email: args.email ?? null,
    });
    if (dup) return { ok: false, error: 'duplicate_found', ...dup };
  }

  const created = await prisma.student.create({
    data: { ...data(args), organizationId: args.organizationId },
    select: { id: true, name: true },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'student_created',
    entity: 'student',
    entityId: created.id,
    // ПДн в аудит не кладём: ни СНИЛС, ни даты рождения — только факт и связь.
    after: { name: created.name, organizationId: args.organizationId },
  });

  return { ok: true, id: created.id };
}

export async function updateStudent(
  prisma: PrismaClient,
  session: SessionPayload,
  args: StudentInput & { id: string; teamMode: boolean }
): Promise<{ ok: true } | { ok: false; error: StudentError; messages?: string[] }> {
  const existing = await prisma.student.findUnique({
    where: { id: args.id },
    select: { id: true, organizationId: true, name: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };

  const access = await studentOrgAccess(prisma, session, existing.organizationId, args.teamMode);
  if (!access.canWrite) return { ok: false, error: 'forbidden' };

  const valid = validate(args);
  if (!valid.ok) return { ok: false, error: 'validation', messages: valid.messages };

  await prisma.student.update({ where: { id: args.id }, data: data(args) });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'student_updated',
    entity: 'student',
    entityId: args.id,
    before: { name: existing.name },
    // Запасное значение недостижимо по той же причине, что и в `data()`:
    // пустое имя не проходит `validate` парой строк выше.
    /* v8 ignore next */
    after: { name: clean(args.name) ?? existing.name },
  });

  return { ok: true };
}

/**
 * Деактивация, а не удаление: у сотрудника есть удостоверения и позиции заявок,
 * физическое удаление осиротило бы историю обучения.
 */
export async function deactivateStudent(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { id: string; teamMode: boolean }
): Promise<{ ok: true } | { ok: false; error: StudentError }> {
  const existing = await prisma.student.findUnique({
    where: { id: args.id },
    select: { id: true, organizationId: true, status: true, name: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };

  const access = await studentOrgAccess(prisma, session, existing.organizationId, args.teamMode);
  if (!access.canWrite) return { ok: false, error: 'forbidden' };

  await prisma.student.update({ where: { id: args.id }, data: { status: 'inactive' } });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'student_deactivated',
    entity: 'student',
    entityId: args.id,
    before: { status: existing.status },
    after: { status: 'inactive' },
  });

  return { ok: true };
}
