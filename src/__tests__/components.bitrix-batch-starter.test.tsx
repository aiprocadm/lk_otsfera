// @vitest-environment jsdom
/**
 * Связка двух форм вкладки «Пакеты» (этап 2 PR-3, `У-189` file, `У-193`).
 *
 * Проверяется ровно то, ради чего обёртка и появилась: ключи загруженных
 * выгрузок доезжают до формы пакета. Без этого источник «Загруженные
 * выгрузки» оставался заперт, сколько файлов ни грузи.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

const { uploadForm, newBatchForm } = vi.hoisted(() => ({
  uploadForm: vi.fn(),
  newBatchForm: vi.fn(),
}));

vi.mock('@/components/bitrix/upload-form', () => ({
  BitrixUploadForm: (props: { onUploaded?: (files: unknown[]) => void }) => {
    uploadForm(props);
    return (
      <button
        type="button"
        onClick={() =>
          props.onUploaded?.([
            {
              key: 'bitrix-import/uploads/u1/1-companies.csv',
              name: 'companies.csv',
              entity: 'company',
            },
          ])
        }
      >
        Загрузить
      </button>
    );
  },
}));

vi.mock('@/components/bitrix/new-batch-form', () => ({
  NewBatchForm: (props: { fileKeys: { name: string }[]; hasConnection: boolean }) => {
    newBatchForm(props);
    return <div data-testid="new-batch">{props.fileKeys.map((f) => f.name).join(', ')}</div>;
  },
}));

import { BitrixBatchStarter } from '@/components/bitrix/batch-starter';

const MANAGERS = [{ id: 'm1', name: 'Анна' }];

describe('BitrixBatchStarter', () => {
  it('до загрузки форма пакета не знает ни одного файла', () => {
    const { getByTestId } = render(
      <BitrixBatchStarter managers={MANAGERS} hasConnection={false} />
    );

    expect(getByTestId('new-batch').textContent).toBe('');
    expect(newBatchForm).toHaveBeenCalledWith(
      expect.objectContaining({ managers: MANAGERS, hasConnection: false, fileKeys: [] })
    );
  });

  it('после успешной загрузки ключи файлов доезжают до формы пакета', () => {
    const { getByText, getByTestId } = render(
      <BitrixBatchStarter managers={MANAGERS} hasConnection />
    );

    fireEvent.click(getByText('Загрузить'));

    expect(getByTestId('new-batch').textContent).toBe('companies.csv');
    expect(newBatchForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fileKeys: [
          {
            key: 'bitrix-import/uploads/u1/1-companies.csv',
            name: 'companies.csv',
            entity: 'company',
          },
        ],
      })
    );
  });
});
