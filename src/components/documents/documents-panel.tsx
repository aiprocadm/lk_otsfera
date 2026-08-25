'use client';

import React, { useState, type FormEvent } from 'react';
import { fmtDateTime } from '@/lib/format';
import { useClientResource } from '@/hooks/useClientResource';

type DocumentItem = {
  id: string;
  name: string;
  mimeType: string;
  orderId: string | null;
  createdAt: string;
};

// Роут /api/documents/upload отдаёт UPPER_CASE-коды с англоязычным message —
// переводим локально (центральный словарь держит lower_snake-коды §3).
const UPLOAD_ERROR_RU: Record<string, string> = {
  BAD_REQUEST: 'Укажите ID заказа и выберите файл.',
  INVALID_FILE_FORMAT: 'Неподдерживаемый формат файла. Допустимы PDF и DOCX.',
  FILE_TOO_LARGE: 'Файл превышает допустимый размер.',
  NOT_FOUND: 'Заказ с таким ID не найден.',
  ORGANIZATION_CONTEXT_NOT_FOUND: 'У заказа не указана организация.',
  STORAGE_UPLOAD_FAILED: 'Не удалось сохранить файл в хранилище. Попробуйте ещё раз.',
};

export function DocumentsPanel({ orderId: fixedOrderId }: { orderId?: string } = {}) {
  const { data: docsData, refetch } = useClientResource<DocumentItem[]>('/api/documents');
  // `У-112`: на карточке заказа панель показывает документы ЭТОГО заказа и не
  // спрашивает его номер — он уже известен. На общем экране всё как было.
  const docs = (docsData ?? []).filter((d) => !fixedOrderId || d.orderId === fixedOrderId);
  const [orderId, setOrderId] = useState(fixedOrderId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || !orderId) return;
    setUploadError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append('orderId', orderId);
    formData.append('file', file);

    const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
    setUploading(false);
    if (res.ok) {
      setFile(null);
      setOrderId(fixedOrderId ?? '');
      refetch();
    } else {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      setUploadError(
        (body?.code && UPLOAD_ERROR_RU[body.code]) ??
          'Не удалось загрузить документ. Попробуйте ещё раз.'
      );
    }
  }

  async function onDownload(id: string) {
    setDownloadError(null);
    const res = await fetch(`/api/documents/${id}/download`, { method: 'POST' });
    if (!res.ok) {
      setDownloadError(
        res.status === 410
          ? 'Файл в карантине: не прошёл антивирусную проверку.'
          : 'Не удалось получить ссылку для скачивания.'
      );
      return;
    }
    const { downloadUrl } = await res.json();
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="font-semibold text-[#111111] mb-4 flex items-center gap-2">
          <span className="w-5 h-5 bg-[#F97316] rounded flex items-center justify-center text-white text-xs">
            ↑
          </span>
          Загрузить документ
        </h2>
        <form onSubmit={onUpload} className="space-y-3">
          {!fixedOrderId && (
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="ID заказа"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
            />
          )}
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-[#F97316] transition-colors">
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-500"
            />
            {file && <p className="text-xs text-[#F97316] mt-1">{file.name}</p>}
          </div>
          {uploadError && (
            <div
              className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
              role="alert"
            >
              {uploadError}
            </div>
          )}
          <button
            type="submit"
            disabled={uploading}
            className="bg-[#F97316] hover:bg-[#EA580C] text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-60"
          >
            {uploading ? 'Загружаем...' : 'Загрузить'}
          </button>
        </form>
      </div>

      {/* Documents list */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="w-5 h-5 bg-[#111111] rounded flex items-center justify-center text-white text-xs">
            D
          </span>
          <span className="font-semibold text-[#111111]">Документы</span>
          <span className="ml-auto text-xs text-gray-400">{docs.length} файлов</span>
        </div>
        {downloadError && (
          <div
            className="mx-5 mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
            role="alert"
          >
            {downloadError}
          </div>
        )}
        {docs.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400 text-sm">Документов пока нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xl">📄</span>
                  <div>
                    <div className="text-sm font-medium text-[#111111]">{doc.name}</div>
                    <div className="text-xs text-gray-400">
                      {doc.mimeType} · {fmtDateTime(new Date(doc.createdAt))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onDownload(doc.id)}
                  className="text-xs border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] text-gray-600 rounded-lg px-3 py-1.5 transition-colors"
                >
                  Скачать
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
