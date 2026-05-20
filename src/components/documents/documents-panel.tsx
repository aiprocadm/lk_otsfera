'use client';

import { useEffect, useState, type FormEvent } from 'react';

type DocumentItem = {
  id: string;
  name: string;
  mimeType: string;
  orderId: string;
  createdAt: string;
};

export function DocumentsPanel() {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [orderId, setOrderId] = useState('');
  const [file, setFile] = useState<File | null>(null);

  async function loadDocs() {
    const res = await fetch('/api/documents');
    if (!res.ok) return;
    setDocs(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load pattern, setState called in async callback
    void loadDocs();
  }, []);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || !orderId) return;
    const formData = new FormData();
    formData.append('orderId', orderId);
    formData.append('file', file);

    const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
    if (res.ok) {
      setFile(null);
      await loadDocs();
    }
  }

  async function onDownload(id: string) {
    const res = await fetch(`/api/documents/${id}/download`, { method: 'POST' });
    if (!res.ok) return;
    const { downloadUrl } = await res.json();
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className='space-y-6'>
      <form onSubmit={onUpload} className='space-y-3 rounded border p-4'>
        <h2 className='font-medium'>Загрузить документ</h2>
        <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder='Order ID' className='w-full rounded border p-2' />
        <input type='file' accept='.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document' onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button type='submit' className='rounded bg-black px-3 py-2 text-white'>Upload</button>
      </form>

      <div className='space-y-2'>
        <h2 className='font-medium'>Документы</h2>
        {docs.map((doc) => (
          <div key={doc.id} className='flex items-center justify-between rounded border p-3'>
            <div>
              <div>{doc.name}</div>
              <div className='text-xs text-gray-500'>{doc.mimeType} · {new Date(doc.createdAt).toLocaleString()}</div>
            </div>
            <button onClick={() => onDownload(doc.id)} className='rounded border px-3 py-1'>Download</button>
          </div>
        ))}
      </div>
    </div>
  );
}
