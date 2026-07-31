export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-64 bg-gray-200 rounded-lg animate-pulse" />
      <div className="grid gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={`h-24 rounded-xl animate-pulse ${i === 0 ? 'bg-orange-200' : 'bg-gray-200'}`}
          />
        ))}
      </div>
    </div>
  );
}
