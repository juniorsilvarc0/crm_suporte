// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHAT_MEDIA_ALLOWED_MIME,
  CHAT_MEDIA_MAX_BYTES,
  chatMediaPath,
  contactAvatarPath,
  storageContentType,
  toPublicOrigin,
} from "@/lib/storage/chat-media";

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260925120500_storage_realtime.sql"
);

/** O bloco `insert ... 'chat-media'` da migration, até o fim do array. */
function chatMediaBucketSql(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("'chat-media',\n    'chat-media'");
  const end = sql.indexOf("]", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe("política do bucket chat-media", () => {
  it("a lista de tipos é a mesma da migration", () => {
    const fromSql = [...chatMediaBucketSql().matchAll(/'([a-z0-9.+-]+\/[a-z0-9.+-]+)'/g)].map(
      (match) => match[1]
    );
    expect(new Set(fromSql)).toEqual(CHAT_MEDIA_ALLOWED_MIME);
  });

  it("o teto é o mesmo da migration", () => {
    expect(chatMediaBucketSql()).toContain(`${CHAT_MEDIA_MAX_BYTES},`);
  });
});

describe("storageContentType", () => {
  it("tira os parâmetros que o bucket não aceita", () => {
    expect(storageContentType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(storageContentType("IMAGE/JPEG")).toBe("image/jpeg");
  });

  it.each(["text/html", "image/svg+xml", "application/xhtml+xml", "application/javascript", "", null])(
    "grava %s como binário, que o navegador baixa em vez de executar",
    (mime) => {
      expect(storageContentType(mime)).toBe("application/octet-stream");
    }
  );
});

describe("caminhos da mídia", () => {
  it("aponta para as rotas do app, nunca para o storage", () => {
    expect(chatMediaPath("m-1")).toBe("/api/chat/media/m-1");
    expect(chatMediaPath("m-1", "thumb")).toBe("/api/chat/media/m-1?variant=thumb");
    expect(contactAvatarPath("c-1", "abc")).toBe("/api/contacts/c-1/avatar?v=abc");
  });
});

describe("toPublicOrigin", () => {
  const signed =
    "http://host.docker.internal:54321/storage/v1/object/sign/chat-media/chat/a.webp?token=t";

  it("troca a origem interna pela pública", () => {
    expect(toPublicOrigin(signed, "http://host.docker.internal:54321/", "http://localhost:54321")).toBe(
      "http://localhost:54321/storage/v1/object/sign/chat-media/chat/a.webp?token=t"
    );
  });

  it("não mexe em URL de outra origem nem sem as duas variáveis", () => {
    expect(toPublicOrigin(signed, "http://gateway", "http://localhost:54321")).toBe(signed);
    expect(toPublicOrigin(signed, undefined, "http://localhost:54321")).toBe(signed);
  });

  // Regressão de produção (2026-09-28): o supabase-js tira a porta padrão ao
  // montar a URL, então `http://gateway:80` virava `http://gateway/...` e a
  // comparação por texto deixava o navegador com o host interno.
  it("casa a origem mesmo quando a porta padrão some da URL assinada", () => {
    expect(
      toPublicOrigin("http://gateway/storage/v1/object/sign/chat-media/a.mp3?token=t", "http://gateway:80", "https://api.exemplo.test")
    ).toBe("https://api.exemplo.test/storage/v1/object/sign/chat-media/a.mp3?token=t");
    expect(
      toPublicOrigin("http://gateway:80/storage/v1/object/sign/chat-media/a.mp3?token=t", "http://gateway", "https://api.exemplo.test/")
    ).toBe("https://api.exemplo.test/storage/v1/object/sign/chat-media/a.mp3?token=t");
  });

  it("respeita o caminho da base e não troca origem com prefixo só parecido", () => {
    expect(toPublicOrigin("http://gateway/sb/storage/v1/x?token=t", "http://gateway/sb/", "https://api.exemplo.test/sb")).toBe(
      "https://api.exemplo.test/sb/storage/v1/x?token=t"
    );
    const outro = "http://gateway2/storage/v1/x?token=t";
    expect(toPublicOrigin(outro, "http://gateway", "https://api.exemplo.test")).toBe(outro);
    expect(toPublicOrigin("não é url", "http://gateway", "https://api.exemplo.test")).toBe("não é url");
  });
});
