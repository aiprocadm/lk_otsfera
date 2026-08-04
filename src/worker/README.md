# src/worker — фоновый процесс (BullMQ)

Отдельный процесс (`npm run worker:dev`), без UI-импортов (энфорсится `npm run boundaries`).
[index.ts](index.ts) — bootstrap: регистрирует воркеры очередей; cron-расписания тикают только
при `ENABLE_SYNC_CRON=1` (иначе hot standby — очереди слушает, cron не регистрирует).

## Процессоры → очереди

Каждый файл в [processors/](processors/) — один процессор; список очередей —
`QUEUE_NAMES` в [src/lib/jobs/queues.ts](../lib/jobs/queues.ts) (CLAUDE.md §7):
`oneCSync.{pullOrders,pullPayments,pullDocuments,pullOrganizations,pushLead,reconcile}`,
`docs.{generateCommissionPdf,generateCommissionXlsx,calculateMonthlyCommissions,scanDocument}`,
`notifications.{dispatch,certificateExpiry,calendarReminder,taskDueSoon}`,
`monitoring.{evaluateAlerts,slaEscalation}`, `inbound.email.poll`,
`telephony.mango.{recording,backfill}`.

## Retry / DLQ

Дефолт всех очередей: `attempts: 5`, exponential backoff от 1000 мс,
`removeOnComplete: { count: 1000 }`, **`removeOnFail: false`** — упавшие джобы остаются
в Redis как DLQ для расследования; не вырезать. Алертинг по DLQ/lag — процессор
`evaluate-alerts` (пороги `ALERT_*` в `.env`).

## Инварианты

- Guardrail покрытия: [worker.processor-coverage.guardrail.test.ts](../__tests__/worker.processor-coverage.guardrail.test.ts)
  падает, если у процессора нет интеграционного теста.
- Зеркальные security-ветки (например в [processors/scan-document.ts](processors/scan-document.ts)) —
  осознанное дублирование, не «оптимизировать» (CLAUDE.md §12b).
- Graceful shutdown ограничен `WORKER_SHUTDOWN_TIMEOUT_MS` (default 25000 мс).
