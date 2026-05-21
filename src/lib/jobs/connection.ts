import IORedis, { type Redis } from 'ioredis';

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (connection) return connection;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
