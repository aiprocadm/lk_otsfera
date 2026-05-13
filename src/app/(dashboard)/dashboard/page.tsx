import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
export default async function Dashboard(){ const session=await getSession(); if(!session) return null; const [orders,documents,comments]=await Promise.all([
prisma.order.findMany({where:{companyId:session.companyId},take:5,orderBy:{createdAt:'desc'}}),
prisma.document.findMany({take:5,orderBy:{createdAt:'desc'}}),
prisma.comment.findMany({take:5,orderBy:{createdAt:'desc'}})
]);
return <main className='p-6 space-y-4'><h1 className='text-2xl font-semibold'>Dashboard</h1><div>Заказы: {orders.length} | Документы: {documents.length} | Комментарии: {comments.length}</div></main>; }
