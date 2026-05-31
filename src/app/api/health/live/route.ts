// Liveness: process is up and serving. No dependencies, public.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok' }, { status: 200 });
}
