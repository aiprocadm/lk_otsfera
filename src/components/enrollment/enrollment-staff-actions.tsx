'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { toast } from '@/lib/ui/toast';

/**
 * Действия сотрудника над заявкой на обучение (`У-116`).
 *
 * Раньше они были только в раскрывающейся строке очереди: чтобы утвердить
 * заявку или отметить зачисление, приходилось разворачивать строку прямо в
 * списке. Открыть заявку отдельным экраном было нельзя — деталка существовала
 * только у клиента, который её подал.
 *
 * Правило переходов живёт на сервере (`PATCH /api/enrollments/[id]`); здесь
 * только кнопки, доступные для текущего состояния.
 */
export function EnrollmentStaffActions({
  enrollment,
}: {
  enrollment: {
    id: string;
    status: string;
    studentCount: number;
    items: ReadonlyArray<{ id: string; status: string }>;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/enrollments/${enrollment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(`Не удалось: ${data.error ?? res.status}`);
        return;
      }
      toast.success(ok);
      router.refresh();
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setBusy(false);
    }
  }

  const toTraining = enrollment.items.filter((i) => i.status === 'provisioned');
  const toCerts = enrollment.items.filter((i) => i.status === 'in_training');
  const canReject = enrollment.status === 'pending' || enrollment.status === 'approved';

  const buttons: React.ReactNode[] = [];
  if (enrollment.status === 'pending') {
    buttons.push(
      <Button
        key="approve"
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={() => act({ action: 'approve' }, 'Заявка утверждена')}
      >
        Утвердить
      </Button>
    );
  }
  if (enrollment.status === 'approved') {
    buttons.push(
      <Button
        key="provisioned"
        size="sm"
        variant="primary"
        loading={busy}
        onClick={() => {
          // Одиночной заявке id в LMS обязателен (как в очереди); заявке на
          // нескольких слушателей общий id можно не указывать.
          const sid = window.prompt(
            enrollment.studentCount <= 1
              ? 'ID слушателя в LMS (externalStudentId):'
              : 'Общий ID в LMS (можно оставить пустым):'
          );
          if (sid === null) return;
          if (enrollment.studentCount <= 1 && !sid.trim()) return;
          void act(
            { action: 'markProvisioned', externalStudentId: sid.trim() },
            'Отмечено: зачислены'
          );
        }}
      >
        Зачислены
      </Button>
    );
  }
  if (toTraining.length > 0) {
    buttons.push(
      <Button
        key="training"
        size="sm"
        variant="primary"
        loading={busy}
        onClick={() => act({ action: 'markInTraining' }, 'Отмечено: идёт обучение')}
      >
        Идёт обучение
      </Button>
    );
  }
  if (toCerts.length > 0) {
    buttons.push(
      <Button
        key="certs"
        size="sm"
        variant="primary"
        loading={busy}
        onClick={() => act({ action: 'markCertificatesReady' }, 'Отмечено: удостоверения готовы')}
      >
        Удостоверения готовы
      </Button>
    );
  }
  if (canReject) {
    buttons.push(
      <Button
        key="reject"
        size="sm"
        variant="danger"
        loading={busy}
        onClick={() => {
          const reason = window.prompt('Причина отклонения:');
          if (reason !== null) void act({ action: 'reject', reason }, 'Заявка отклонена');
        }}
      >
        Отклонить
      </Button>
    );
  }

  if (buttons.length === 0) {
    // §15: экран без кнопок объясняет, почему их нет, а не молчит.
    return (
      <p className="text-sm text-gray-500">
        Заявка прошла весь путь — действий над ней больше нет.
      </p>
    );
  }

  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}
