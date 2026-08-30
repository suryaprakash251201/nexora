export function SkeletonLine({ width = '100%', height = '16px' }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function SkeletonFileRow({ index = 0 }: { index?: number }) {
  const widths = ['75%', '65%', '80%', '55%', '70%', '85%', '60%', '90%'];
  const subWidths = ['45%', '35%', '50%', '40%'];
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="skeleton w-9 h-9 rounded-lg shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="skeleton h-3.5" style={{ width: widths[index % widths.length] }} />
        <div className="skeleton h-2.5" style={{ width: subWidths[index % subWidths.length] }} />
      </div>
      <div className="skeleton h-3 w-16 shrink-0" />
    </div>
  );
}

export function SkeletonListRow({ index = 0 }: { index?: number }) {
  const widths = ['75%', '65%', '80%', '55%', '70%', '85%', '60%', '90%'];
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 px-4 sm:px-6 py-3 rounded-xl">
      <div className="w-6 flex justify-center items-center shrink-0">
        <div className="skeleton w-4 h-4 rounded" />
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <div className="skeleton w-10 h-10 rounded-xl shrink-0" />
        <div className="skeleton h-3.5 min-w-0 flex-1 max-w-[50%]" style={{ width: widths[index % widths.length] }} />
      </div>
      <div className="skeleton h-3 w-16 shrink-0 self-center" />
      <div className="skeleton h-3 w-24 shrink-0 self-center" />
    </div>
  );
}

export function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => <SkeletonListRow key={i} index={i} />)}
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

export function SkeletonFolderBrowser({ count = 5 }: { count?: number }) {
  return (
    <div className="p-2 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="skeleton w-6 h-6 rounded shrink-0" />
          <div className="flex-1">
            <div className="skeleton h-3.5 w-3/4" />
            <div className="skeleton h-2 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonSearchResults({ count = 5 }: { count?: number }) {
  return (
    <div className="p-2 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3 glass rounded-xl">
          <div className="skeleton w-8 h-8 rounded shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-2.5 w-1/3" />
          </div>
          <div className="skeleton h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}