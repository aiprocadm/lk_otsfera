'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui';
import { CreateLeadFromSourceDialog, type LeadPrefill, type LeadSourceKind } from './create-lead-from-source-dialog';
import { QuickTaskDialog } from './quick-task-dialog';

/**
 * Этап 7 (ФТ-1.6, ФТ-7.5) — пара действий «Создать лид» / «Задача» для карточки
 * обращения и строки звонка (переиспользуется и вне Intake-экрана).
 * `showLead=false` — когда лид из источника уже создан (@unique-связь).
 */
export function SourceIntakeActions({
  kind,
  sourceId,
  leadPrefill,
  taskTitle,
  organizationId,
  currentUserId,
  showLead = true
}: {
  kind: LeadSourceKind;
  sourceId: string;
  leadPrefill: LeadPrefill;
  taskTitle: string;
  organizationId: string | null;
  currentUserId: string;
  showLead?: boolean;
}) {
  const [leadOpen, setLeadOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-1.5">
      {showLead && (
        <Button size="sm" variant="secondary" onClick={() => setLeadOpen(true)}>
          Создать лид
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => setTaskOpen(true)}>
        Задача
      </Button>
      {leadOpen && (
        <CreateLeadFromSourceDialog kind={kind} sourceId={sourceId} prefill={leadPrefill} onClose={() => setLeadOpen(false)} />
      )}
      {taskOpen && (
        <QuickTaskDialog
          titlePrefill={taskTitle}
          organizationId={organizationId}
          currentUserId={currentUserId}
          onClose={() => setTaskOpen(false)}
        />
      )}
    </div>
  );
}
