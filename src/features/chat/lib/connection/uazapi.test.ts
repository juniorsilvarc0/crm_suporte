import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadUazapiMedia } from "./uazapi";

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(impl as unknown as typeof fetch);
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const API = "https://inst.uazapi.com";
const TOKEN = "tok-123";

describe("downloadUazapiMedia", () => {
  it("POSTa /message/download com { id } + header token e devolve fileURL+mimetype", async () => {
    const spy = mockFetch(
      () =>
        new Response(
          JSON.stringify({ fileURL: "https://inst.uazapi.com/files/x.jpg", mimetype: "image/jpeg" }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    const out = await downloadUazapiMedia(API, TOKEN, "MSG1");
    expect(out).toEqual({ fileURL: "https://inst.uazapi.com/files/x.jpg", mimetype: "image/jpeg" });

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://inst.uazapi.com/message/download");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).token).toBe(TOKEN);
    expect(JSON.parse(init.body as string)).toEqual({ id: "MSG1" });
  });

  it("aceita as variações de nome fileUrl/mimeType", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ fileUrl: "https://inst.uazapi.com/files/a.ogg", mimeType: "audio/ogg" }), {
          status: 200,
        })
    );
    const out = await downloadUazapiMedia(API, TOKEN, "MSG2");
    expect(out).toEqual({ fileURL: "https://inst.uazapi.com/files/a.ogg", mimetype: "audio/ogg" });
  });

  it("null quando a mensagem não é achada (404)", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: "Message not found" }), { status: 404 }));
    expect(await downloadUazapiMedia(API, TOKEN, "NOPE")).toBeNull();
  });

  it("null quando o corpo não traz fileURL", async () => {
    mockFetch(() => new Response(JSON.stringify({ mimetype: "image/jpeg" }), { status: 200 }));
    expect(await downloadUazapiMedia(API, TOKEN, "MSG3")).toBeNull();
  });

  it("null quando o fetch falha (rede/timeout)", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    expect(await downloadUazapiMedia(API, TOKEN, "MSG4")).toBeNull();
  });
});
