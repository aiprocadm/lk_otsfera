import { SignJWT, jwtVerify } from 'jose';
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
export type SessionPayload = { sub: string; role: 'client'|'manager'|'admin'; companyId: string };
export async function signToken(payload: SessionPayload){ return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setExpirationTime('7d').sign(secret); }
export async function verifyToken(token: string){ const { payload } = await jwtVerify(token, secret); return payload as unknown as SessionPayload; }
