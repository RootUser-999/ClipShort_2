export function EditorSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading video editor">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <div className="aspect-video w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-44 w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="space-y-4 lg:col-span-5">
          <div className="h-80 w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-36 w-full animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>
    </div>
  );
}
