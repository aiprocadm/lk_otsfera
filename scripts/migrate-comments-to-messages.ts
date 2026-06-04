import { PrismaClient } from '@prisma/client';
import { migrateCommentsToMessages } from '../src/lib/services/chat/migrate';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await migrateCommentsToMessages(prisma);
    console.log('[migrate-comments-to-messages]', result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
