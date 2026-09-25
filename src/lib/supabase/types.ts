// Tipos do banco.
//
// `database.types.ts` é GERADO do banco local — não edite à mão. Mudou uma
// migration? Aplique (`./scripts/db-local-apply.sh`) e regenere:
//   pnpm db:types
// O tipo escrito à mão que existia aqui desviava do banco em silêncio; o
// gerado não tem como desviar.
export type { Database, Json } from "./database.types";

// Valores de `integration_logs.status` (check no banco).
export type IntegrationStatus = "ok" | "error";
