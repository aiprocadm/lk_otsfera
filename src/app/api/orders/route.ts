import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (s.role === 'admin') {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(orders);
  }

  const where =
    s.role === 'organization' && s.organizationId
      ? {
          company: {
            organizations: {
              some: { id: s.organizationId }
            }
          }
        }
      : s.role === 'partner' && s.partnerId
        ? {
            company: {
              organizations: {
                some: { partnerId: s.partnerId }
              }
            }
          }
        : s.role === 'manager'
          ? {
              company: {
                organizations: {
                  some: {
                    organizationUsers: {
                      some: { userId: s.sub, isActive: true }
                    }
                  }
                }
              }
            }
          : null;

  if (!where) return NextResponse.json([], { status: 200 });

  const orders = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' } });
  return NextResponse.json(orders);
}
