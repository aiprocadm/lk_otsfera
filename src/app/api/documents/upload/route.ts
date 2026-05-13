import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
export async function POST(req: Request){ const s=await getSession(); if(!s) return NextResponse.json({error:'Unauthorized'},{status:401}); const {orderId,name,path,mimeType}=await req.json(); const doc=await prisma.document.create({data:{orderId,name,path,mimeType,uploadedById:s.sub}}); return NextResponse.json(doc); }
