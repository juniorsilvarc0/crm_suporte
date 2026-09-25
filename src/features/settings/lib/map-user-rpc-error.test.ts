import { describe, expect, it } from "vitest";

import { mapUserRpcError } from "@/features/settings/lib/map-user-rpc-error";

describe("mapUserRpcError", () => {
  it("mapeia EMAIL_TAKEN para 409 no campo email", () => {
    expect(mapUserRpcError("EMAIL_TAKEN")).toEqual({
      status: 409,
      message: "Já existe um usuário com este email.",
      field: "email",
    });
  });

  it("mapeia WEAK_PASSWORD para 422 no campo password", () => {
    const mapped = mapUserRpcError("WEAK_PASSWORD");
    expect(mapped.status).toBe(422);
    expect(mapped.field).toBe("password");
  });

  it("mapeia SELF_DEACTIVATE e LAST_ACTIVE_USER", () => {
    expect(mapUserRpcError("SELF_DEACTIVATE").status).toBe(400);
    expect(mapUserRpcError("LAST_ACTIVE_USER").status).toBe(409);
  });

  it("mapeia USER_NOT_FOUND para 404", () => {
    expect(mapUserRpcError("USER_NOT_FOUND").status).toBe(404);
  });

  it("cai em 500 para erro desconhecido", () => {
    expect(mapUserRpcError("algo inesperado").status).toBe(500);
    expect(mapUserRpcError(undefined).status).toBe(500);
  });
});
