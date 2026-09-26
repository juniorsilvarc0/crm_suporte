// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENTS_BUCKET,
  isInlineAttachment,
  putTicketAttachment,
  removeTicketAttachment,
  sanitizeAttachmentFileName,
  signTicketAttachment,
  ticketAttachmentKey,
} from "@/lib/storage/ticket-attachments";

type Admin = Parameters<typeof putTicketAttachment>[0]["supabase"];

const MIGRATION = path.join(process.cwd(), "supabase/migrations/20260925120900_tickets.sql");
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
// sha256("abc"), o vetor de teste do FIPS 180-2.
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

const storageFrom = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const createSignedUrl = vi.fn();
const supabase = { storage: { from: storageFrom } } as unknown as Admin;

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  storageFrom.mockReturnValue({ upload, remove, createSignedUrl });
  upload.mockResolvedValue({ data: { path: "x" }, error: null });
  remove.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  vi.unstubAllEnvs();
});

describe("contrato com a migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("a chave gerada passa no CHECK de object_key", () => {
    const pattern = /object_key ~ '([^']+)'/.exec(sql)?.[1];
    expect(pattern).toBeDefined();
    const key = ticketAttachmentKey(TICKET_ID);

    expect(key).toMatch(new RegExp(pattern ?? "$^"));
    expect(key.startsWith(`tickets/${TICKET_ID}/`)).toBe(true);
  });

  it("a chave usa o id em minúsculas, como ticket_id::text", () => {
    expect(ticketAttachmentKey(TICKET_ID.toUpperCase()).startsWith(`tickets/${TICKET_ID}/`)).toBe(
      true
    );
  });

  it("o teto é o do CHECK de tamanho e o bucket é o default da coluna", () => {
    expect(sql).toContain(`check (size_bytes between 1 and ${TICKET_ATTACHMENT_MAX_BYTES})`);
    expect(sql).toMatch(new RegExp(`bucket\\s+text not null default '${TICKET_ATTACHMENTS_BUCKET}'`));
  });
});

describe("sanitizeAttachmentFileName", () => {
  it.each([
    ["relatório.pdf", "relatório.pdf"],
    ["C:\\fakepath\\nota.pdf", "nota.pdf"],
    ["../../etc/passwd", "passwd"],
    ["  planilha.xlsx  ", "planilha.xlsx"],
    ["fatura\u202Efdp.exe", "faturafdp.exe"],
    ["a\u0000b\u0007.txt", "ab.txt"],
    ["relato\u0301rio.pdf", "relatório.pdf"],
    ["", "arquivo"],
    ["   ", "arquivo"],
    ["pasta/", "arquivo"],
  ])("%j → %j", (raw, expected) => {
    expect(sanitizeAttachmentFileName(raw)).toBe(expected);
  });

  it("corta em 255 caracteres mantendo a extensão", () => {
    const name = sanitizeAttachmentFileName(`${"a".repeat(300)}.pdf`);

    expect(Array.from(name)).toHaveLength(255);
    expect(name.endsWith("a.pdf")).toBe(true);
  });

  it("conta emoji como um caractere, como o char_length do Postgres", () => {
    const name = sanitizeAttachmentFileName(`${"😀".repeat(300)}.png`);

    expect(Array.from(name)).toHaveLength(255);
    expect(name.endsWith("😀.png")).toBe(true);
    // Nenhum par de surrogate partido no corte.
    expect(name).not.toMatch(/\p{Cs}/u);
  });

  it("sem extensão reconhecível, só corta", () => {
    const name = sanitizeAttachmentFileName("b".repeat(300));

    expect(name).toBe("b".repeat(255));
  });
});

describe("isInlineAttachment", () => {
  it.each(["image/png", "video/mp4", "audio/ogg", "application/pdf"])("%s abre no navegador", (mime) => {
    expect(isInlineAttachment(mime)).toBe(true);
  });

  it.each(["application/octet-stream", "text/plain", "application/zip", "text/csv"])(
    "%s sai como download",
    (mime) => {
      expect(isInlineAttachment(mime)).toBe(false);
    }
  );
});

describe("putTicketAttachment", () => {
  it("grava na chave do ticket, sem sobrescrever, com o sha256 calculado aqui", async () => {
    const stored = await putTicketAttachment({
      supabase,
      ticketId: TICKET_ID,
      body: Buffer.from("abc"),
      mime: "application/pdf",
    });

    expect(storageFrom).toHaveBeenCalledWith("ticket-attachments");
    expect(upload).toHaveBeenCalledWith(stored?.objectKey, Buffer.from("abc"), {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(stored).toEqual({
      bucket: "ticket-attachments",
      objectKey: expect.stringMatching(new RegExp(`^tickets/${TICKET_ID}/[0-9a-f-]{36}$`)),
      mime: "application/pdf",
      sizeBytes: 3,
      sha256: SHA256_ABC,
    });
  });

  it.each(["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xml", "text/xml", "application/xhtml+xml", "", null])(
    "guarda %j como application/octet-stream",
    async (mime) => {
      const stored = await putTicketAttachment({
        supabase,
        ticketId: TICKET_ID,
        body: Buffer.from("<script>alert(1)</script>"),
        mime,
      });

      expect(stored?.mime).toBe("application/octet-stream");
      expect(upload).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), {
        contentType: "application/octet-stream",
        upsert: false,
      });
    }
  );

  it("tira os parâmetros do tipo aceito", async () => {
    const stored = await putTicketAttachment({
      supabase,
      ticketId: TICKET_ID,
      body: Buffer.from("a;b"),
      mime: "text/csv; charset=utf-8",
    });

    expect(stored?.mime).toBe("text/csv");
  });

  it("chave nova a cada upload", async () => {
    const first = await putTicketAttachment({ supabase, ticketId: TICKET_ID, body: Buffer.from("1"), mime: "text/plain" });
    const second = await putTicketAttachment({ supabase, ticketId: TICKET_ID, body: Buffer.from("1"), mime: "text/plain" });

    expect(first?.objectKey).not.toBe(second?.objectKey);
  });

  it.each([
    ["vazio", Buffer.alloc(0)],
    ["acima do teto", Buffer.alloc(TICKET_ATTACHMENT_MAX_BYTES + 1)],
  ])("%s → null sem chamar o storage", async (_label, body) => {
    const stored = await putTicketAttachment({ supabase, ticketId: TICKET_ID, body, mime: "text/plain" });

    expect(stored).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("storage recusou → null, logado", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "The resource already exists" } });

    const stored = await putTicketAttachment({
      supabase,
      ticketId: TICKET_ID,
      body: Buffer.from("abc"),
      mime: "text/plain",
    });

    expect(stored).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("removeTicketAttachment", () => {
  const KEY = `tickets/${TICKET_ID}/44444444-4444-4444-8444-444444444444`;

  it("apaga só a chave pedida, no bucket dos anexos", async () => {
    await expect(removeTicketAttachment(supabase, KEY)).resolves.toBe(true);

    expect(storageFrom).toHaveBeenCalledWith("ticket-attachments");
    expect(remove).toHaveBeenCalledWith([KEY]);
  });

  it.each(["chat/2026/09/a.webp", "tickets/../chat/x", "", `tickets/${TICKET_ID}/`])(
    "recusa chave fora do padrão %j sem chamar o storage",
    async (key) => {
      await expect(removeTicketAttachment(supabase, key)).resolves.toBe(false);

      expect(remove).not.toHaveBeenCalled();
    }
  );

  it("storage recusou → false, logado", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(removeTicketAttachment(supabase, KEY)).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("signTicketAttachment", () => {
  const KEY = `tickets/${TICKET_ID}/44444444-4444-4444-8444-444444444444`;
  const INTERNAL = "http://host.docker.internal:54321";
  const PUBLIC = "http://localhost:54321";
  const SIGNED = `${INTERNAL}/storage/v1/object/sign/ticket-attachments/${KEY}?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ4In0.c2ln`;

  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", INTERNAL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PUBLIC);
    createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
  });

  it("assina só no bucket dos anexos, na origem pública, sem download para o que abre no navegador", async () => {
    const url = await signTicketAttachment(
      supabase,
      { object_key: KEY, file_name: "print.png", mime: "image/png" },
      600
    );

    expect(storageFrom).toHaveBeenCalledWith("ticket-attachments");
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 600);
    expect(url).toBe(SIGNED.replace(INTERNAL, PUBLIC));
  });

  it("octet-stream baixa com o nome original, acentos e espaços inteiros", async () => {
    const url = await signTicketAttachment(
      supabase,
      { object_key: KEY, file_name: "relatório final.html", mime: "application/octet-stream" },
      600
    );

    const parsed = new URL(url ?? "");
    expect(parsed.origin).toBe(PUBLIC);
    expect(parsed.searchParams.get("token")).toBe(new URL(SIGNED).searchParams.get("token"));
    expect(parsed.searchParams.get("download")).toBe("relatório final.html");
  });

  it("storage recusou → null", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "Object not found" } });

    const url = await signTicketAttachment(
      supabase,
      { object_key: KEY, file_name: "a.zip", mime: "application/zip" },
      600
    );

    expect(url).toBeNull();
  });
});
