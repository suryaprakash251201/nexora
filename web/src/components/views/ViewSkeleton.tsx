/** Branded loading placeholder for lazily-loaded views. */
import { SkeletonLine, SkeletonCard } from "../ui/Skeleton";

export function ViewSkeleton() {
  return (
    <div className="flex-1 grid place-items-center p-6" role="status" aria-label="Loading view">
      <div className="w-full max-w-5xl space-y-3 animate-fade-in">
        <SkeletonLine width="180px" height="24px" />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    </div>
  );
}
