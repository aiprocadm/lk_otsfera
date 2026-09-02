// @vitest-environment jsdom
/**
 * Этап 6, PR-8a (`У-151`, дефекты `Д-3` и `Д-5`) — карточка документа:
 * «Указать номер» для бумаги из 1С и «Перевыпустить» для нашей.
 *
 * Проверяем не наличие кнопок, а то, что экран **говорит правду**: блок
 * «нет номера» показывается ровно там, где номера нет и есть право его
 * вписать; отказ сервера виден по-русски и не притворяется успехом; форма
 * перевыпуска грузится только по клику, а при отказе не открывается пустое
 * окно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setDocumentNumberAction, reissuePanelAction, acceptDocumentAction, sendDocumentAction } =
  vi.hoisted(() => ({
    setDocumentNumberAction: vi.fn(),
    reissuePanelAction: vi.fn(),
    acceptDocumentAction: vi.fn(),
    sendDocumentAction: vi.fn(),
  }));
vi.mock('@/server-actions/documents/number', () => ({ setDocumentNumberAction }));
vi.mock('@/server-actions/documents/reissue', () => ({ reissuePanelAction }));
vi.mock('@/server-actions/documents/accept', () => ({ acceptDocumentAction }));
vi.mock('@/server-actions/documents/send', () => ({ sendDocumentAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

/**
 * Диалог выпуска — чужая, уже покрытая деталь. Здесь важно только то, ЧТО
 * кнопка перевыпуска в него передаёт: тот же документ и запертый тип.
 */
vi.mock('@/components/manager/issue-document-dialog', () => ({
  IssueDocumentDialog: (props: {
    open: boolean;
    onClose: () => void;
    reissueOfDocumentId?: string;
    lockedDocType?: string;
  }) =>
    props.open ? (
      <div
        data-testid="issue-dialog"
        data-reissue-of={props.reissueOfDocumentId}
        data-locked-type={props.lockedDocType}
      >
        Форма выпуска
        <button type="button" onClick={props.onClose}>
          Закрыть форму
        </button>
      </div>
    ) : null,
}));

import { DocumentDetailView } from '@/components/documents/document-detail-view';
import { ReissueDocumentButton } from '@/components/documents/reissue-document-button';
import type { DocumentDetail } from '@/lib/services/documents/detail';

function doc(over: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: 'doc1',
    name: 'Счёт №5',
    type: 'invoice',
    direction: 'outgoing',
    number: 'С-2026-5',
    version: 1,
    size: 2048,
    mimeType: 'application/pdf',
    scanStatus: 'clean',
    scanReason: null,
    signedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    uploadedByName: 'Иванов',
    status: 'issued',
    amountGross: '12000.00',
    sentAt: null,
    acceptedAt: null,
    payment: null,
    order: { id: 'ord1', title: 'Заказ', orderNumber: 'ON-1' },
    rejectReason: null,
    counterparty: { type: 'organization', id: 'org1', name: 'ООО Ромашка' },
    ...over,
  };
}

const PANEL = {
  docType: 'invoice',
  target: { kind: 'order' as const, orderId: 'ord1' },
  counterpartyName: 'ООО «Ромашка»',
  missingByType: { invoice: [], act: [], contract: [], extra_agreement: [] },
  baseDocuments: [],
  hasInvoice: true,
  hasContract: false,
  lines: [],
  catalog: [],
};

const NO_NUMBER_TEXT = /У документа нет номера/;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Блок «нет номера» в карточке (`У-151`, `Д-5`)', () => {
  it('показывается сотруднику ЦО у документа без номера — иначе акт по нему не выпустить', () => {
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" canSetNumber />);
    expect(screen.getByText(NO_NUMBER_TEXT)).toBeTruthy();
    expect(screen.getByLabelText('Номер документа')).toBeTruthy();
  });

  it('у документа с номером блока нет: номер напечатан в файле, править его нельзя', () => {
    render(<DocumentDetailView document={doc()} backHref="/x" canSetNumber />);
    expect(screen.queryByText(NO_NUMBER_TEXT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Указать номер' })).toBeNull();
  });

  it('без права блока нет даже при пустом номере: заказчику номера не выдумывать', () => {
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" />);
    expect(screen.queryByText(NO_NUMBER_TEXT)).toBeNull();
  });

  it('пока поле пустое, кнопка неактивна — пустой номер сервер всё равно отвергнет', () => {
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" canSetNumber />);
    const btn = screen.getByRole('button', { name: 'Указать номер' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // Пробел номером не является: кнопка остаётся закрытой.
    fireEvent.change(screen.getByLabelText('Номер документа'), { target: { value: '   ' } });
    expect(
      (screen.getByRole('button', { name: 'Указать номер' }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('Номер документа'), { target: { value: 'С-2026-17' } });
    expect(
      (screen.getByRole('button', { name: 'Указать номер' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('успех показывает сохранённый номер и убирает форму — пропсы с сервера не обновятся сами', async () => {
    setDocumentNumberAction.mockResolvedValue({ ok: true });
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" canSetNumber />);

    fireEvent.change(screen.getByLabelText('Номер документа'), {
      target: { value: ' С-2026-17 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Указать номер' }));

    await waitFor(() => expect(screen.getByText(/Номер сохранён: С-2026-17/)).toBeTruthy());
    expect(screen.queryByText(NO_NUMBER_TEXT)).toBeNull();

    // На сервер уезжает документ и введённый номер, а не что-то из соседнего поля.
    const fd = setDocumentNumberAction.mock.calls[0]![0] as FormData;
    expect(fd.get('documentId')).toBe('doc1');
    expect(fd.get('number')).toBe(' С-2026-17 ');
  });

  it('отказ сервера показывается по-русски и форма остаётся — номер не сохранён', async () => {
    setDocumentNumberAction.mockResolvedValue({ ok: false, error: 'number_taken' });
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" canSetNumber />);

    fireEvent.change(screen.getByLabelText('Номер документа'), { target: { value: 'С-2026-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Указать номер' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('уже занят');
    expect(screen.getByText(NO_NUMBER_TEXT)).toBeTruthy();
    expect(screen.queryByText(/Номер сохранён/)).toBeNull();
  });

  it('обрыв связи — тоже видимое сообщение, а кнопка снова нажимается', async () => {
    setDocumentNumberAction.mockRejectedValue(new Error('offline'));
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" canSetNumber />);

    fireEvent.change(screen.getByLabelText('Номер документа'), { target: { value: 'С-2026-17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Указать номер' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Сетевая ошибка');
    // Кнопка разблокирована: иначе после разрыва связи повторить было бы нечем.
    expect(
      (screen.getByRole('button', { name: 'Указать номер' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });
});

describe('Кнопка «Перевыпустить» в карточке (`У-151`, `Д-3`)', () => {
  it('видна сотруднику у документа с номером', () => {
    render(<DocumentDetailView document={doc()} backHref="/x" canReissue />);
    expect(screen.getByRole('button', { name: 'Перевыпустить' })).toBeTruthy();
  });

  it('без права её нет: заказчик и партнёр документы не выпускают', () => {
    render(<DocumentDetailView document={doc()} backHref="/x" />);
    expect(screen.queryByRole('button', { name: 'Перевыпустить' })).toBeNull();
  });

  it('у документа без номера её нет: перевыпускать нечего — номер не наш', () => {
    render(<DocumentDetailView document={doc({ number: null })} backHref="/x" canReissue />);
    expect(screen.queryByRole('button', { name: 'Перевыпустить' })).toBeNull();
  });

  it('у заражённого файла её нет: содержимое прежней версии читать нельзя', () => {
    render(
      <DocumentDetailView
        document={doc({ scanStatus: 'infected', scanReason: 'EICAR' })}
        backHref="/x"
        canReissue
      />
    );
    expect(screen.queryByRole('button', { name: 'Перевыпустить' })).toBeNull();
  });
});

describe('ReissueDocumentButton — форма перевыпуска (`У-151`)', () => {
  it('данные формы грузятся по клику, а не при каждом просмотре карточки', async () => {
    reissuePanelAction.mockResolvedValue({ ok: true, panel: PANEL });
    render(<ReissueDocumentButton documentId="doc1" />);
    expect(reissuePanelAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await waitFor(() => expect(reissuePanelAction).toHaveBeenCalledTimes(1));
    const fd = reissuePanelAction.mock.calls[0]![0] as FormData;
    expect(fd.get('documentId')).toBe('doc1');
  });

  it('успех открывает форму, помеченную перевыпуском этого документа и его типом', async () => {
    reissuePanelAction.mockResolvedValue({ ok: true, panel: PANEL });
    render(<ReissueDocumentButton documentId="doc1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    const dialog = await screen.findByTestId('issue-dialog');
    expect(dialog.getAttribute('data-reissue-of')).toBe('doc1');
    // Тип заперт: перевыпуск — та же бумага, а не повод выпустить другую.
    expect(dialog.getAttribute('data-locked-type')).toBe('invoice');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('отказ сервера объясняется по-русски, а пустое окно не открывается', async () => {
    reissuePanelAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<ReissueDocumentButton documentId="doc1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const msg = String(toastError.mock.calls[0]![0]);
    expect(msg).toMatch(/[А-Яа-я]/);
    expect(msg).not.toContain('forbidden');
    expect(screen.queryByTestId('issue-dialog')).toBeNull();
    // Кнопка вернулась в рабочее состояние — отказ не должен её вешать.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Перевыпустить' }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
  });

  it('код «нечего перевыпускать» не показывается сырым словом', async () => {
    reissuePanelAction.mockResolvedValue({ ok: false, error: 'not_reissuable' });
    render(<ReissueDocumentButton documentId="doc1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const msg = String(toastError.mock.calls[0]![0]);
    expect(msg).not.toContain('not_reissuable');
    expect(msg).toMatch(/[А-Яа-я]/);
    expect(screen.queryByTestId('issue-dialog')).toBeNull();
  });

  it('обрыв связи — сообщение, а не молчаливо мёртвая кнопка', async () => {
    reissuePanelAction.mockRejectedValue(new Error('offline'));
    render(<ReissueDocumentButton documentId="doc1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(String(toastError.mock.calls[0]![0])).toContain('Сетевая ошибка');
    expect(screen.queryByTestId('issue-dialog')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Перевыпустить' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('пока форма грузится, кнопка занята и повторный клик её не дублирует', async () => {
    let release: (v: unknown) => void = () => {};
    reissuePanelAction.mockReturnValue(
      new Promise((res) => {
        release = res;
      })
    );
    render(<ReissueDocumentButton documentId="doc1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Готовлю форму…' }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Готовлю форму…' }));
    expect(reissuePanelAction).toHaveBeenCalledTimes(1);

    release({ ok: true, panel: PANEL });
    await screen.findByTestId('issue-dialog');
  });

  it('закрытие формы гасит окно, а кнопка открывает его снова', async () => {
    reissuePanelAction.mockResolvedValue({ ok: true, panel: PANEL });
    render(<ReissueDocumentButton documentId="doc1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await screen.findByTestId('issue-dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть форму' }));
    expect(screen.queryByTestId('issue-dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить' }));
    await waitFor(() => expect(reissuePanelAction).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('issue-dialog')).toBeTruthy();
  });
});
