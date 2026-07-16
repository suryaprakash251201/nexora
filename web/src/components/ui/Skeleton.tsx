export function SkeletonLine({ width = '100%', height = '16px' }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function SkeletonFileRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="skeleton w-9 h-9 rounded-lg shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="skeleton h-3.5" style={{ width: `${60 + Math.random() * 30}%` }} />
        <div className="skeleton h-2.5" style={{ width: `${30 + Math.random() * 20}%` }} />
      </div>
      <div className="skeleton h-3 w-16 shrink-0" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="glass rounded-xl p-3 space-y-2.5">
      <div className="skeleton w-full aspect-square rounded-lg" />
      <div className="skeleton h-3.5" style={{ width: '75%' }} />
      <div className="skeleton h-2.5" style={{ width: '50%' }} />
    </div>
  );
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-border/30">
      {Array.from({ length: count }).map((_, i) => <SkeletonFileRow key={i} />)}
    </div>
  );
}
