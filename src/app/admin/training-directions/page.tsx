import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listDirections } from '@/lib/services/training';
import { DirectionsAdmin } from '@/components/training/directions-admin';

export const dynamic = 'force-dynamic';

export default async function AdminTrainingDirectionsPage() {
  const session = await requireAdmin();
  const res = await listDirections(prisma, session, { includeInactive: true });
  const directions = res.ok ? res.directions : [];

  return <DirectionsAdmin directions={directions} />;
}
