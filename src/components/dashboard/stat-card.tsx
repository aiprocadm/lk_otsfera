export function StatCard({ title, value, accent }: { title: string; value: number | string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-2 shadow-sm transition-shadow hover:shadow-md ${accent ? 'bg-[#F97316] border-[#EA580C] text-white' : 'bg-white border-gray-200'}`}>
      <div className={`text-xs font-medium uppercase tracking-wider ${accent ? 'text-orange-100' : 'text-gray-500'}`}>
        {title}
      </div>
      <div className={`text-3xl font-bold ${accent ? 'text-white' : 'text-[#111111]'}`}>
        {value}
      </div>
    </div>
  );
}
