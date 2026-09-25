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
});
