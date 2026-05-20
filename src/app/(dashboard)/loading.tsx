export default function Loading() {
  return (
    <main className='p-6 space-y-3'>
      <div className='h-7 w-48 bg-slate-200 rounded animate-pulse' />
      <div className='space-y-2'>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className='h-12 w-full bg-slate-200 rounded animate-pulse' />
        ))}
      </div>
    </main>
  );
}
