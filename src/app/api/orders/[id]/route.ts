import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
export async function PATCH(req:Request,{params}:{params:{id:string}}){ const {status}=await req.json(); const order=await prisma.order.update({where:{id:params.id},data:{status}}); return NextResponse.json(order); }
