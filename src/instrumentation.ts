// Hook de instrumentação do Next 16: `register()` roda UMA vez por processo de
// servidor, no boot. Usamos só para ligar o worker de jobs de fundo (Fase 6),
// e SÓ quando RUN_JOBS=true e no runtime Node (nunca no edge). Em produção, o
// RUN_JOBS no .env do servidor liga/desliga o worker sem rebuild.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_JOBS !== "true") return;

  // Import dinâmico: o worker (service-role) não entra em bundle de edge/cliente.
  const { startJobs } = await import("@/lib/jobs/worker");
  startJobs();
}
