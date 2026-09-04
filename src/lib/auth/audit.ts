import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * Типы сущностей журнала аудита. Массив, а не только тип: русский словарь
 * (`lib/audit/labels`) обязан покрывать каждое значение, а проверить это можно
 * лишь по рантайм-списку — Prisma держит `entity` свободной строкой.
 */
export const AUDIT_ENTITIES = [
  'user',
  'partner',
  'organization',
  'organization_user',
  'organization_manager',
  'order',
  'commission_statement',
  'lead',
  'lead_attachment',
  'client_request',
  'client_request_attachment',
  'document',
  'partner_user',
  'student_bridge',
  // У-31 (этап 5): справочник сотрудников — сущность операций над Student.
  'student',
  'order_thread',
  'company',
  'sync_state',
  'sync_schedule',
  // `У-126`: настройки ops-оповещений.
  'alert_settings',
  // `У-127`: правило маршрутизации уведомлений.
  'notification_rule',
  // `У-128`: текст письма.
  'document_template',
  'email_template',
  // `У-129`: политики входа.
  'login_policies',
  'job_queue',
  'payment',
  'feature_flag',
  'one_c_import',
  'one_c_pending',
  'enrollment_request',
  'order_item',
  'certificate',
  'custom_field_definition',
  'custom_field_value',
  'commission_correction',
  'access_profile',
  'funnel_stage',
  'deal',
  'deal_stage',
  'task',
  'task_column',
  'auth_2fa',
  'contact',
  'call',
  'inbound_message',
  'staff_conversation',
  'calendar_event',
  'integration_setting',
  'order_status_definition',
  // `У-136`: каталог услуг и цены.
  'catalog_item',
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/**
 * Коды действий журнала аудита — единый реестр. `AuditRecord.action`
 * типизирован этим объединением, поэтому новое событие невозможно записать,
 * не внеся его сюда, а тест полноты требует к нему русское название. Так
 * англоязычное значение физически не может просочиться в интерфейс.
 */
export const AUDIT_ACTIONS = [
  '2fa_backup_regenerated',
  '2fa_backup_used',
  '2fa_code_sent',
  '2fa_failed',
  '2fa_verified',
  'STUDENT_BRIDGE_CLIENT_DENIED',
  'STUDENT_BRIDGE_CODE_EXCHANGED',
  'STUDENT_BRIDGE_CODE_ISSUED',
  'STUDENT_BRIDGE_CODE_REJECTED',
  'STUDENT_BRIDGE_CODE_REUSE_BLOCKED',
  'STUDENT_BRIDGE_RATE_LIMITED',
  'STUDENT_BRIDGE_TOKEN_ISSUED',
  'access_profile_created',
  'access_profile_deleted',
  'access_profile_updated',
  'admin_bootstrapped',
  'cabinet_question_submitted',
  'calendar_event_created',
  'calendar_event_deleted',
  'calendar_event_updated',
  'call_bound',
  'call_initiated',
  'certificate_created',
  'certificate_issued',
  'certificate_scan_attached',
  'client_request_attachment_deleted',
  'client_request_attachment_uploaded',
  'client_request_converted',
  'client_request_rejected',
  'client_request_submitted',
  'client_request_taken',
  'comment_posted',
  'commission_correction_applied',
  'commission_correction_waived',
  'commission_statement_approved',
  'commission_statement_calculated',
  'commission_statement_paid',
  'contact_created',
  'cursor_rewound',
  'custom_field_definition_create',
  'custom_field_definition_deactivate',
  'custom_field_definition_update',
  'custom_field_values_set',
  'deal_created',
  'deal_note_created',
  'deal_stage_changed',
  'deal_stage_created',
  'deal_stage_deleted',
  'deal_stage_updated',
  'deal_updated',
  'deal_won_order_created',
  'document_download_signed_url',
  'document_generated',
  'document_upload',
  'document_uploaded',
  'enrollment_approved',
  // У-34а (этап 6): администратор проставил направление старой заявке.
  'enrollment_legacy_direction_assigned',
  'enrollment_items_advanced',
  'enrollment_provisioned',
  'enrollment_rejected',
  'enrollment_submitted',
  'funnel_stage_created',
  'funnel_stage_deleted',
  'funnel_stage_updated',
  'inbound_message_archived',
  'inbound_message_bound',
  'inbound_message_replied',
  'inbound_message_restored',
  'intake_call_closed',
  'intake_claimed',
  'integration_settings_updated',
  'invite_resent',
  'lead_assigned',
  'lead_created_from_call',
  'lead_created_from_inbound',
  'lead_created_manual',
  'lead_promoted_to_deal',
  'lead_promoted_to_order',
  'lead_push_enqueued',
  'lead_rejected',
  'lead_status_changed',
  'login',
  'manager_assigned',
  'manager_deactivated',
  'manager_reactivated',
  'manager_role_changed',
  'manager_team_visibility_changed',
  'max_linked',
  'max_unlinked',
  'message_sent',
  'feature_flag.changed',
  'one_c_import.commit',
  'one_c_import.rollback',
  'one_c_pending_requeued',
  'order_accounting_signed',
  'order_deliverables_approved',
  'order_item_added',
  'order_item_removed',
  'order_item_status_changed',
  'order_manager_changed',
  'order_result_delivered',
  'order_self_assigned',
  'order_status_changed',
  'order_status_definition_create',
  'order_status_definition_delete',
  'order_status_definition_update',
  'org_member_deactivated',
  'org_member_invited',
  'org_member_reactivated',
  'org_member_role_changed',
  'organization_created_auto',
  'lead_organization_linked',
  'organization_created_manual',
  'proposal_accepted',
  'organization_egrul_filled',
  'organization_rate_override',
  'organization_updated',
  'partner_commission_rate_changed',
  'partner_created',
  'partner_deactivated',
  'partner_member_deactivated',
  'partner_member_invited',
  'partner_member_scope_changed',
  'partner_reactivated',
  'partner_updated',
  'password_reset',
  'payment_import.commit',
  'payment_import.rollback',
  'requisites_changed',
  'sales_target_cleared',
  'sales_target_set',
  'sessions_revoked',
  'sla_settings_changed',
  'staff_message_sent',
  // У-31 (этап 5): операции над сотрудником справочника.
  'student_created',
  'student_deactivated',
  'student_updated',
  'sync_dlq_bulk_retried',
  'sync_schedule_paused',
  'sync_schedule_resumed',
  // `У-125`: расписание правится из интерфейса — правку видно в журнале.
  'sync_schedule_pattern_changed',
  'onec_params_changed',
  // `У-126`: пороги и канал ops-оповещений.
  'alert_settings_changed',
  'alert_test_sent',
  // `У-127`: правила маршрутизации уведомлений.
  'notification_rule_changed',
  'notification_rules_reset',
  // `У-129`: сроки и лимиты входа.
  'login_policies_changed',
  // `У-128`: свои тексты писем.
  'document_number_set',
  'document_template_changed',
  'document_template_reset',
  'email_template_changed',
  'email_template_reset',
  'email_template_test_sent',
  // `У-136`: каталог услуг и цены; история изменений цены — before/after
  // в catalog_item_updated.
  // `У-148` (этап 6): жизненный цикл документа.
  'document_status_changed',
  // `У-149`: отправка документа заказчику письмом, в том числе повторная.
  'document_sent',
  // `У-159`, этап 8 (`У-168`): выгрузка документа в 1С — каждая попытка,
  // удачная и нет; повтор выгрузки пишется тем же событием.
  'document_pushed_to_1c',
  'document_push_to_1c_failed',
  // `У-169`: сотрудник нажал «Выгрузить в 1С» или «Повторить» (`after.retry`).
  'document_push_to_1c_requested',
  // `У-173`: пакет документов для 1С скачан файлом — одно событие на пакет,
  // `entityId` — запись пакета в `SyncLog`, список документов в `after`.
  'documents_exported_to_1c_file',
  'order_total_synced',
  'requisites_requested',
  'catalog_item_created',
  // `У-139`/`У-140`: финансовые строки заказа и ручная сумма.
  'order_line_added',
  'order_line_updated',
  'order_line_removed',
  'order_lines_built_from_items',
  'order_total_set_manually',
  'order_total_recalculated',
  // `У-138`: налоги, нумерация и оформление компании-исполнителя.
  'company_tax_settings_changed',
  'company_numbering_changed',
  // `У-169` (этап 8): правило выгрузки документов в 1С — режим и набор типов.
  'company_onec_push_rule_changed',
  'company_branding_uploaded',
  'company_branding_removed',
  'catalog_imported',
  'catalog_item_updated',
  'catalog_item_deactivated',
  'catalog_item_activated',
  'sync_triggered',
  'task_assigned',
  'task_column_created',
  'task_column_deleted',
  'task_column_updated',
  'task_created',
  'task_deleted',
  'task_moved',
  'task_updated',
  'telegram_linked',
  'telegram_unlinked',
  'user_access_profile_assigned',
  'user_created',
  'user_deactivated',
  'user_reactivated',
  'user_role_changed',
  'user_updated',
  'whatsapp_phone_removed',
  'whatsapp_phone_saved',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditRecord = {
  userId: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
  status?: 'success' | 'denied' | undefined;
  reason?: string | undefined;
};

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function recordAudit(prisma: PrismaLike, rec: AuditRecord): Promise<void> {
  const meta: Prisma.JsonObject = {
    status: rec.status ?? 'success',
  };
  if (rec.before !== undefined) meta.before = rec.before as Prisma.JsonObject;
  if (rec.after !== undefined) meta.after = rec.after as Prisma.JsonObject;
  if (rec.reason !== undefined) meta.reason = rec.reason;

  await prisma.auditLog.create({
    data: {
      userId: rec.userId,
      action: rec.action,
      entity: rec.entity,
      entityId: rec.entityId,
      meta,
    },
  });
}
