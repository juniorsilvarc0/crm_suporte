---
name: testes
description: Use para criar, rodar ou expandir testes automatizados neste projeto (Vitest + Testing Library + msw). Gatilhos - "teste", "vitest", "cobertura", "escrever teste", "testar componente/função/query".
---

# Testes no CRM Suporte

Guia prático para escrever e rodar testes neste projeto (Next.js 16 + React 19 + TypeScript strict + Supabase).

## Stack

- **Vitest** (test runner) + **@testing-library/react** (componentes) + **jsdom** (ambiente DOM).
- **msw** para mockar HTTP e chamadas ao Supabase — nunca teste contra rede ou banco reais.

## Comandos

```bash
pnpm test            # roda a suíte uma vez
pnpm test:watch       # modo watch
pnpm test:coverage    # relatório de cobertura

# dentro do Docker:
docker exec crm-suporte-web pnpm test
```

## Estrutura e convenções

- Teste fica COLOCADO ao lado do arquivo testado: `src/lib/formatters/phone.ts` → `src/lib/formatters/phone.test.ts`.
- Use o alias `@/` para importar de `src/` (ex.: `import { formatPhone } from "@/lib/formatters/phone"`).
- Nomes de teste em português do Brasil, descritivos: `it("deve formatar telefone com DDD")`.
- Ordem de prioridade ao escrever testes: **1) funções puras** (formatters, schemas Zod, normalizers) → **2) queries/rotas** (mock de Supabase/HTTP via msw) → **3) componentes/hooks** (Testing Library).

## Exemplos mínimos

### a) Função pura (formatter)

```ts
// src/lib/formatters/phone.test.ts
import { describe, expect, it } from "vitest";
import { formatPhone } from "@/lib/formatters/phone";

describe("formatPhone", () => {
  it("deve formatar telefone com DDD e nono dígito", () => {
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
  });

  it("deve retornar string vazia quando o valor de entrada é vazio", () => {
    expect(formatPhone("")).toBe("");
  });
});
```

### b) Schema Zod (válido + inválido)

```ts
// src/features/leads/schemas/lead.test.ts
import { describe, expect, it } from "vitest";
import { leadSchema } from "@/features/leads/schemas/lead";

describe("leadSchema", () => {
  it("deve aceitar um lead com dados válidos", () => {
    const resultado = leadSchema.safeParse({
      nome: "Maria Silva",
      telefone: "11987654321",
      email: "maria@example.com",
    });

    expect(resultado.success).toBe(true);
  });

  it("deve rejeitar lead sem telefone", () => {
    const resultado = leadSchema.safeParse({
      nome: "Maria Silva",
      email: "maria@example.com",
    });

    expect(resultado.success).toBe(false);
  });
});
```

### c) Componente com Testing Library

```tsx
// src/features/leads/components/lead-card.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeadCard } from "@/features/leads/components/lead-card";

describe("LeadCard", () => {
  it("deve chamar onSelecionar quando o card é clicado", async () => {
    const usuario = userEvent.setup();
    const onSelecionar = vi.fn();

    render(<LeadCard nome="Maria Silva" onSelecionar={onSelecionar} />);

    await usuario.click(screen.getByRole("button", { name: /maria silva/i }));

    expect(onSelecionar).toHaveBeenCalledOnce();
  });
});
```

### d) Mock de chamada Supabase/HTTP com msw

```ts
// src/features/leads/queries/get-leads.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { getLeads } from "@/features/leads/queries/get-leads";

const server = setupServer(
  http.get("*/rest/v1/leads", () => {
    return HttpResponse.json([{ id: "1", nome: "Maria Silva" }]);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("getLeads", () => {
  it("deve retornar a lista de leads mapeada", async () => {
    const leads = await getLeads();

    expect(leads).toEqual([{ id: "1", nome: "Maria Silva" }]);
  });

  it("deve lançar erro quando a resposta falha", async () => {
    server.use(
      http.get("*/rest/v1/leads", () => HttpResponse.error()),
    );

    await expect(getLeads()).rejects.toThrow();
  });
});
```

## Checklist antes de commitar

- [ ] `pnpm typecheck` passa sem erros.
- [ ] `pnpm test` passa 100% (nenhum teste pulado sem justificativa).
- [ ] Nenhum teste bate em rede, banco de dados ou serviço externo real — tudo mockado via msw.
- [ ] Nomes de `describe`/`it` estão em português do Brasil e descrevem o comportamento, não a implementação.
- [ ] Sem snapshots frágeis nem duplicação de cobertura.
