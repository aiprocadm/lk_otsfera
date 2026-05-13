import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
export default async function Orders(){ const s=await getSession(); if(!s) return null; const orders=await prisma.order.findMany({where:{companyId:s.companyId},include:{manager:true}}); return <main className='p-6'><h1 className='text-xl font-semibold mb-3'>Заказы</h1><div className='space-y-2'>{orders.map((o: { id: string; title: string; status: string })=><Link key={o.id} href={`/orders/${o.id}`} className='block border p-3 rounded'>{o.title} — {o.status}</Link>)}</div></main>}
