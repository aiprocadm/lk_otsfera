export function StatCard({ title, value }: { title: string; value: number }) {
  return <div className='rounded-lg border bg-white p-4'><div className='text-sm text-slate-500'>{title}</div><div className='text-2xl font-semibold'>{value}</div></div>;
}
