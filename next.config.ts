import type { NextConfig } from "next";

// Origens extras liberadas no dev server (ex.: acessar o app pelo IP da rede
// local para testar no celular). Configure via variável de ambiente, sem
// hardcode de IP: ALLOWED_DEV_ORIGINS="192.168.0.10,192.168.0.11"
const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Headers de segurança (defesa em profundidade). NÃO usamos uma CSP restritiva
// de scripts (exigiria nonce e quebraria o Next/hidratação) — apenas a diretiva
// frame-ancestors contra clickjacking, além de anti-sniffing, referrer e HSTS
// (esta só em produção, pois só faz sentido sob HTTPS).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Saída standalone: o `next build` emite `.next/standalone/server.js` com só as
  // deps rastreadas — permite uma imagem de produção enxuta (sem node_modules
  // inteiro). Não afeta o dev (`next dev`).
  output: "standalone",
  // ⚠️ O rastreio do `standalone` NÃO leva a biblioteca compartilhada do sharp.
  //
  // Ele reconhece addon nativo e copia o `.node`, mas o `.node` do sharp linka
  // contra `libvips-cpp.so`, resolvido pelo carregador do sistema via RPATH —
  // invisível para quem só segue `require()`. O resultado é uma imagem que
  // constrói limpa e quebra no primeiro upload de foto, com
  // `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file`.
  //
  // O glob passa pelo `.pnpm` de propósito: com pnpm, `node_modules/@img` não
  // existe no topo — é tudo link para dentro do store.
  outputFileTracingIncludes: {
    "**": ["./node_modules/.pnpm/@img+sharp-libvips-*/**"],
  },
  experimental: {
    // Sobe o limite de body (default 10MB) — necessário p/ upload de anexos
    // (vídeo/arquivo) via multipart no route handler /send-file.
    proxyClientMaxBodySize: "64mb",
  },
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
