# Dev image — CRM Suporte (Next.js 16 + React 19 + pnpm)
# Debian slim para máxima compatibilidade com deps nativas (sharp/unrs-resolver).
FROM node:22-bookworm-slim

# pnpm via corepack — respeita o packageManager fixado no package.json (pnpm@10.33.0)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Camada de dependências primeiro (cache de build). Só invalida se os manifests mudarem.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Código-fonte. Em dev fica sombreado pelo bind mount do compose; presente para runs standalone.
COPY . .

EXPOSE 3000

# next dev já escuta em 0.0.0.0 por padrão (no host, localhost:3200: o compose mapeia 3200 → 3000).
CMD ["pnpm", "dev"]
