// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Выпуск документов **без заказа**: счёт/договор/ДС организации (`У-145`) и
 * коммерческое предложение лиду (`У-161`).
 *
 * Здесь проверяется не сама форма выпуска (у неё свой тест), а обязанности
 * этого файла: данные грузятся **по открытию**, а не при отрисовке карточки;
 * сбой загрузки не оставляет молча неработающую кнопку; и форма называет
 * **настоящую** цель — у лида с заведённой организацией документ уходит
 * организации, и написать «лиду» значило бы отправить человека искать бумагу
 * не туда.
 *
 * Сама форма подменена заглушкой, которая печатает переданные ей свойства:
 * так видно, что именно этот файл ей передал.
 */
const actions = vi.hoisted(() => ({
  orgIssuePanelAction: vi.fn(),
  leadIssuePanelAction: vi.fn(),
}));
vi.mock('@/server-actions/documents/generate', () => actions);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: toastMock }));

const dialogProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock('@/components/manager/issue-document-dialog', () => ({
  IssueDocumentDialog: (props: Record<string, unknown>) => {
    dialogProps.last = props;
    return (
      <div data-testid="issue-dialog">
        форма выпуска
        <button type="button" onClick={props.onClose as () => void}>
          закрыть форму
        </button>
      </div>
    );
  },
}));

import {
  IssueOrderLessDocumentButton,
  IssueOrderLessDocumentDialog,
  IssueLeadProposalButton,
  IssueLeadProposalDialog,
} from '@/components/documents/issue-order-less-document-button';

const PANEL = {
  counterpartyName: 'ООО «Ромашка»',
  missingByType: {},
  baseDocuments: [],
  hasContract: true,
  catalog: [],
  defaultVatRate: 20,
  proposalValidDays: 14,
};

beforeEach(() => {
  vi.clearAllMocks();
  dialogProps.last = null;
  actions.orgIssuePanelAction.mockResolvedValue({ ok: true, panel: PANEL });
  actions.leadIssuePanelAction.mockResolvedValue({ ok: true, panel: PANEL, organizationId: null });
});

describe('Кнопка выпуска документа организации', () => {
  it('до нажатия ничего не грузится — карточка не платит за неоткрытую форму', () => {
    render(<IssueOrderLessDocumentButton organizationId="o1" />);

    expect(actions.orgIssuePanelAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Создать документ' })).toBeTruthy();
  });

  it('своя подпись кнопки перекрывает стандартную', () => {
    render(<IssueOrderLessDocumentButton organizationId="o1" label="Выставить счёт" />);

    expect(screen.getByRole('button', { name: 'Выставить счёт' })).toBeTruthy();
  });

  it('нажатие грузит данные и открывает форму', async () => {
    render(<IssueOrderLessDocumentButton organizationId="o1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Создать документ' }));

    await screen.findByTestId('issue-dialog');
    const fd = actions.orgIssuePanelAction.mock.calls[0]?.[0] as FormData;
    expect(fd.get('organizationId')).toBe('o1');
  });

  it('закрытие формы убирает её, а кнопка остаётся на месте', async () => {
    render(<IssueOrderLessDocumentButton organizationId="o1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать документ' }));
    await screen.findByTestId('issue-dialog');

    fireEvent.click(screen.getByRole('button', { name: 'закрыть форму' }));

    expect(screen.queryByTestId('issue-dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Создать документ' })).toBeTruthy();
  });
});

describe('Форма выпуска документа организации', () => {
  it('пока данные не пришли — на экране ничего', () => {
    actions.orgIssuePanelAction.mockReturnValue(new Promise(() => {}));

    render(<IssueOrderLessDocumentDialog organizationId="o1" onClose={vi.fn()} />);

    expect(screen.queryByTestId('issue-dialog')).toBeNull();
  });

  it('сбой загрузки объясняет причину и закрывает форму — кнопка не «молчит»', async () => {
    const onClose = vi.fn();
    actions.orgIssuePanelAction.mockResolvedValue({ ok: false, error: 'forbidden' });

    render(<IssueOrderLessDocumentDialog organizationId="o1" onClose={onClose} />);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('issue-dialog')).toBeNull();
  });

  it('строкам из сделки проставляется ставка НДС компании', async () => {
    render(
      <IssueOrderLessDocumentDialog
        organizationId="o1"
        onClose={vi.fn()}
        prefillLines={[
          { title: 'Обучение', amount: '1000' } as never,
          { title: 'С своей ставкой', amount: '500', vatRate: 0 } as never,
        ]}
        defaultSubject="Сделка №7"
      />
    );

    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last?.orderLines).toEqual([
      { title: 'Обучение', amount: '1000', vatRate: 20 },
      { title: 'С своей ставкой', amount: '500', vatRate: 0 },
    ]);
    expect(dialogProps.last?.defaultSubject).toBe('Сделка №7');
    // Акта без заказа не бывает — счёт-основание форма не спрашивает.
    expect(dialogProps.last?.hasInvoice).toBe(false);
  });

  it('номер сделки передаётся только когда он есть', async () => {
    const { unmount } = render(
      <IssueOrderLessDocumentDialog organizationId="o1" onClose={vi.fn()} dealId="d9" />
    );
    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last?.dealId).toBe('d9');
    unmount();

    render(<IssueOrderLessDocumentDialog organizationId="o1" onClose={vi.fn()} />);
    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last).not.toHaveProperty('dealId');
  });

  it('форма, закрытая до ответа сервера, ничего не показывает', async () => {
    let release: (v: unknown) => void = () => {};
    actions.orgIssuePanelAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const { unmount } = render(
      <IssueOrderLessDocumentDialog organizationId="o1" onClose={vi.fn()} />
    );
    unmount();
    release({ ok: true, panel: PANEL });
    await Promise.resolve();

    expect(screen.queryByTestId('issue-dialog')).toBeNull();
  });
});

describe('Коммерческое предложение лиду', () => {
  it('до нажатия каталог не грузится', () => {
    render(<IssueLeadProposalButton leadId="l1" />);

    expect(actions.leadIssuePanelAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выставить КП' })).toBeTruthy();
  });

  it('своя подпись и номер сделки доходят до формы', async () => {
    render(<IssueLeadProposalButton leadId="l1" label="Предложение" dealId="d3" />);

    fireEvent.click(screen.getByRole('button', { name: 'Предложение' }));

    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last?.dealId).toBe('d3');
  });

  it('без сделки свойство не передаётся вовсе', async () => {
    render(<IssueLeadProposalButton leadId="l1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Выставить КП' }));

    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last).not.toHaveProperty('dealId');
  });

  it('закрытие формы лида убирает её', async () => {
    render(<IssueLeadProposalButton leadId="l1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Выставить КП' }));
    await screen.findByTestId('issue-dialog');

    fireEvent.click(screen.getByRole('button', { name: 'закрыть форму' }));

    expect(screen.queryByTestId('issue-dialog')).toBeNull();
  });

  it('лиду без организации документ выставляется лиду, и тип заперт на предложении', async () => {
    render(<IssueLeadProposalDialog leadId="l1" onClose={vi.fn()} />);

    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last?.target).toEqual({ kind: 'lead', leadId: 'l1' });
    expect(dialogProps.last?.lockedDocType).toBe('commercial_proposal');
    expect(dialogProps.last?.orderLines).toEqual([]);
  });

  it('у лида с заведённой организацией форма называет настоящую цель', async () => {
    actions.leadIssuePanelAction.mockResolvedValue({
      ok: true,
      panel: PANEL,
      organizationId: 'o7',
    });

    render(<IssueLeadProposalDialog leadId="l1" onClose={vi.fn()} />);

    await screen.findByTestId('issue-dialog');
    expect(dialogProps.last?.target).toEqual({ kind: 'organization', organizationId: 'o7' });
  });

  it('сбой загрузки объясняет причину и закрывает форму', async () => {
    const onClose = vi.fn();
    actions.leadIssuePanelAction.mockResolvedValue({ ok: false, error: 'not_found' });

    render(<IssueLeadProposalDialog leadId="l1" onClose={onClose} />);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('форма лида, закрытая до ответа, ничего не показывает', async () => {
    let release: (v: unknown) => void = () => {};
    actions.leadIssuePanelAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const { unmount } = render(<IssueLeadProposalDialog leadId="l1" onClose={vi.fn()} />);
    unmount();
    release({ ok: true, panel: PANEL, organizationId: null });
    await Promise.resolve();

    expect(screen.queryByTestId('issue-dialog')).toBeNull();
  });
});
