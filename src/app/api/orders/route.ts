import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orders = await prisma.order.findMany({
    where: {
      companyId: s.companyId ?? undefined,
      company: {
        organizations: {
          some: {
            organizationUsers: {
              some: {
                userId: s.sub,
                isActive: true
              }
            }
          }
        }
      }
    }
  });

  return NextResponse.json(orders);
}
