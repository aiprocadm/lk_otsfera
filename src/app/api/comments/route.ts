import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
export async function POST(req:Request){ const s=await getSession(); if(!s) return NextResponse.json({error:'Unauthorized'},{status:401}); const {orderId,body}=await req.json(); const comment=await prisma.comment.create({data:{orderId,body,authorId:s.sub}}); return NextResponse.json(comment); }
