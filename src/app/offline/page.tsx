import type { Metadata } from "next";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sem conexão",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-transparent px-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sem conexão
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Você está offline
        </h1>
        <p className="text-sm text-muted-foreground">
          A operação precisa de internet para mostrar dados atualizados. Verifique sua
          conexão e tente novamente.
        </p>
      </div>
    </main>
  );
}
