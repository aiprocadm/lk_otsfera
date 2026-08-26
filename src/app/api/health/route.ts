// Readiness: can the app serve traffic? Checks DB + Redis + S3. Token-gated.
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { checkDb, checkRedis, checkS3 } from '@/lib/health/checks';
import { secretEquals } from '@/lib/security/secretCompare';
import { isSecretsKeyConfigured } from '@/lib/crypto/secrets';

export const dynamic = 'force-dynamic';

function bearerMatches(req: NextRequest, expected: string): boolean {
  const header = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  return secretEquals(header.slice(prefix.length), expected);
}

export async function GET(req: NextRequest) {
  const expected = process.env.HEALTH_TOKEN?.trim();
  if (!expected) {
    // Fail closed: a misconfigured probe reads as "not ready", surfaced loudly
    // on the first readiness check after deploy rather than silently public.
    return Response.json({ status: 'down', reason: 'health_token_unconfigured' }, { status: 503 });
  }
  if (!bearerMatches(req, expected)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }

  const [db, redis, s3] = await Promise.all([checkDb(prisma), checkRedis(), checkS3()]);
  // `У-132` (дефект `Д-36`): без мастер-ключа секреты интеграций сохранить
  // нельзя. Это не мешает отдавать трафик, поэтому в `status` состояние ключа
  // НЕ входит — иначе балансировщик снял бы живой сервер из-за настройки. Но в
  // ответе оно видно: раньше узнать об отсутствии ключа можно было только
  // нажав «Сохранить» в форме интеграций.
  const secretsKey = { ok: isSecretsKeyConfigured(), ms: 0 };
  const ok = db.ok && redis.ok && s3.ok;
  return Response.json(
    { status: ok ? 'ok' : 'down', checks: { db, redis, s3, secretsKey } },
    { status: ok ? 200 : 503 }
  );
}
