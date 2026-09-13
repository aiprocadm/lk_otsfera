'use client';
import React, { useState } from 'react';
import { BitrixUploadForm } from './upload-form';
import { NewBatchForm, type ManagerOption, type UploadedFileKey } from './new-batch-form';

/**
 * Две формы вкладки «Пакеты» в одной связке (`У-189` file, `У-193`).
 *
 * Загрузка выгрузок и создание пакета — один сценарий, разорванный на два шага:
 * пока ключи загруженных файлов не доезжают до формы пакета, источник
 * «Загруженные выгрузки» остаётся навсегда заперт, сколько файлов ни грузи.
 * Поэтому состояние живёт здесь, между формами, а не внутри каждой.
 */
export function BitrixBatchStarter({
  managers,
  hasConnection,
}: {
  managers: ManagerOption[];
  hasConnection: boolean;
}) {
  const [fileKeys, setFileKeys] = useState<UploadedFileKey[]>([]);

  return (
    <div className="space-y-4">
      <BitrixUploadForm onUploaded={setFileKeys} />
      <NewBatchForm managers={managers} fileKeys={fileKeys} hasConnection={hasConnection} />
    </div>
  );
}
