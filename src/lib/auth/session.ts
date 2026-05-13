import { cookies } from 'next/headers';
import { verifyToken } from './jwt';
export async function getSession(){
  const token = (await cookies()).get('session')?.value;
  if (!token) return null;
  try { return await verifyToken(token); } catch { return null; }
}
