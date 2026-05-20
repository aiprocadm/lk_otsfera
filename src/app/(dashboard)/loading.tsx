export default function Loading() {
  return (
    <div className='space-y-4'>
      <div className='h-8 w-56 bg-gray-200 rounded-lg animate-pulse' />
      <div className='bg-white border border-gray-200 rounded-xl overflow-hidden'>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className='flex gap-4 px-5 py-4 border-b border-gray-50 last:border-0'>
            <div className='h-4 w-1/3 bg-gray-200 rounded animate-pulse' />
            <div className='h-4 w-20 bg-orange-100 rounded-full animate-pulse' />
            <div className='h-4 w-24 bg-gray-100 rounded animate-pulse' />
          </div>
        ))}
      </div>
    </div>
  );
}
