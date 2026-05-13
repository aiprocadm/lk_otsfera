'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function LoginPage(){ const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [loading,setLoading]=useState(false); const router=useRouter();
 async function onSubmit(e: React.FormEvent){e.preventDefault(); setLoading(true); const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); setLoading(false); if(res.ok) router.push('/dashboard'); }
 return <main className='min-h-screen grid place-items-center p-6'><form onSubmit={onSubmit} className='w-full max-w-sm space-y-4 border rounded-xl p-6'><h1 className='text-2xl font-semibold'>Вход</h1><input className='w-full border p-2 rounded' placeholder='Email' value={email} onChange={e=>setEmail(e.target.value)} /><input type='password' className='w-full border p-2 rounded' placeholder='Пароль' value={password} onChange={e=>setPassword(e.target.value)} /><button disabled={loading} className='w-full bg-zinc-900 text-white rounded p-2'>{loading?'Входим...':'Войти'}</button></form></main>; }
