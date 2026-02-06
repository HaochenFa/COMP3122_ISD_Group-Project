export default function AssignmentReviewLoading() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-16" aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
        <div className="h-10 w-80 animate-pulse rounded bg-slate-800" />
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={`review-loading-${index}`}
              className="h-64 w-full animate-pulse rounded-3xl border border-white/10 bg-slate-900/60"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
