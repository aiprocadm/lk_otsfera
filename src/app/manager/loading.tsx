export default function Loading() {
  return (
    <main className='p-6 space-y-4'>
      <div className='h-8 w-64 bg-slate-200 rounded animate-pulse' />
      <div className='grid gap-3 md:grid-cols-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className='h-24 bg-slate-200 rounded animate-pulse' />
        ))}
      </div>
    </main>
  );
}
