import { SignJWT, jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export type Role = 'admin' | 'manager' | 'partner' | 'organization' | 'student';

export type SessionPayload = {
  sub: string;
  role: Role;
  companyId?: string | null;
  partnerId?: string | null;
  organizationId?: string | null;
  email?: string;
  name?: string;
};

export async function signToken(payload: SessionPayload) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').sign(secret);
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload as unknown as SessionPayload;
}
