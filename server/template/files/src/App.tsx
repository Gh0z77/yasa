import { Sparkles } from "lucide-react";

/** Placeholder screen — it is replaced as soon as you describe your app in the chat. */
export default function App() {
  return (
    <main className="relative isolate grid min-h-svh place-items-center overflow-hidden bg-background px-6 py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 animate-fade-in">
        <div className="absolute top-1/2 left-1/2 size-[34rem] max-w-[120vw] -translate-x-1/2 -translate-y-[58%] rounded-full bg-primary/20 blur-3xl dark:bg-primary/25" />
        <div className="absolute top-1/2 left-1/2 size-72 -translate-x-[110%] -translate-y-[10%] rounded-full bg-chart-2/20 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 size-72 translate-x-[15%] -translate-y-[5%] rounded-full bg-chart-5/15 blur-3xl" />
        <div className="absolute inset-0 bg-radial from-transparent to-background to-70%" />
      </div>

      <div className="flex max-w-md animate-fade-up flex-col items-center text-center">
        <div className="relative mb-7">
          <div className="absolute inset-0 animate-pulse rounded-2xl bg-primary/30 blur-xl" />
          <div className="relative grid size-16 place-items-center rounded-2xl border bg-card/80 shadow-lg backdrop-blur">
            <Sparkles className="size-7 text-primary" strokeWidth={1.75} />
          </div>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          __YASA_PLACEHOLDER_TITLE__
        </h1>
        <p className="mt-4 text-base leading-relaxed text-pretty text-muted-foreground">
          __YASA_PLACEHOLDER_TEXT__
        </p>

        <div className="mt-8 flex items-center gap-1.5" aria-hidden="true">
          <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-primary/70" />
        </div>
      </div>
    </main>
  );
}
