import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  listClientRequestAttachments,
  uploadClientRequestAttachment,
  type ClientRequestAttachmentFailure,
} from '@/lib/services/clientRequests/attachments';
import { log } from '@/lib/logging';

function mapFailureToResponse(f: ClientRequestAttachmentFailure): Response {
  switch (f.error) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: f.message }, { status: 404 });
    case 'FORBIDDEN':
    case 'REQUEST_NOT_EDITABLE':
      return NextResponse.json({ error: f.message }, { status: 403 });
    case 'UNSUPPORTED_MEDIA_TYPE':
      return NextResponse.json({ error: f.message }, { status: 415 });
    case 'FILE_TOO_LARGE':
      return NextResponse.json({ error: f.message }, { status: 413 });
    case 'INVALID_FILENAME':
      return NextResponse.json({ error: f.message }, { status: 400 });
    case 'INFECTED':
      return NextResponse.json(
        { code: 'INFECTED', error: f.message, scanReason: f.meta?.scanReason ?? undefined },
        { status: 410 }
      );
    case 'STORAGE_FAILURE':
    default:
      return NextResponse.json({ error: f.message }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const result = await listClientRequestAttachments(prisma, session, { requestId: id });
    if (!result.ok) return mapFailureToResponse(result);
    return NextResponse.json({ rows: result.rows });
  } catch (err) {
    log.error('[client-requests/attachments] list failed unexpectedly', { requestId: id, err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = notFoundIfDisabled('client_requests');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart form-data' }, { status: 400 });

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Field "file" is required' }, { status: 400 });
  }
  const arrayBuf = await file.arrayBuffer();

  try {
    const result = await uploadClientRequestAttachment(prisma, session, {
      requestId: id,
      file: {
        buffer: new Uint8Array(arrayBuf),
        name: file.name,
        /* v8 ignore next -- file.type is always '' in test env (FormData re-parsing strips MIME); tested in e2e */
        declaredMimeType: file.type || 'application/octet-stream',
        size: file.size,
      },
    });
    if (!result.ok) return mapFailureToResponse(result);
    const { attachment } = result;
    return NextResponse.json(
      {
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        mimeType: attachment.mimeType,
        createdAt: attachment.createdAt,
      },
      { status: 201 }
    );
  } catch (err) {
    log.error('[client-requests/attachments] upload failed unexpectedly', { requestId: id, err });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
