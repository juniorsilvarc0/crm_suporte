import { describe, it, expect } from "vitest";

import { decideRouteAccess, isPublicApiRoute } from "@/lib/auth/route-guard";

describe("decideRouteAccess", () => {
  describe("rotas internas de /api", () => {
    it("bloqueia com 401 quando não há sessão", () => {
      expect(decideRouteAccess("/api/leads/search", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/financeiro/sales", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/appointments/123", false)).toEqual({
        type: "unauthorized",
      });
      expect(decideRouteAccess("/api/chat/conversations/1/send", false)).toEqual(
        { type: "unauthorized" }
      );
    });

    it("libera quando há sessão válida", () => {
      expect(decideRouteAccess("/api/leads/search", true)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/chat/conversations", true)).toEqual({
        type: "allow",
      });
    });

    it("limita tráfego pago às APIs do rastreamento", () => {
      expect(
        decideRouteAccess("/api/meta/tracking/export", true, "paid_traffic")
      ).toEqual({ type: "allow" });
      expect(
        decideRouteAccess("/api/meta/tracking/export/", true, "paid_traffic")
      ).toEqual({ type: "allow" });
      expect(decideRouteAccess("/api/leads/search", true, "paid_traffic")).toEqual({
        type: "forbidden",
      });
      expect(
        decideRouteAccess("/api/chat/conversations", true, "paid_traffic")
      ).toEqual({ type: "forbidden" });
    });
  });

  describe("rotas de API públicas (autenticação própria)", () => {
    it("libera webhooks do n8n mesmo sem sessão", () => {
      expect(decideRouteAccess("/api/webhooks/n8n/lead", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/webhooks/n8n/appointment", false)).toEqual({
        type: "allow",
      });
    });

    it("libera webhooks de chat mesmo sem sessão", () => {
      expect(decideRouteAccess("/api/chat/webhook/evolution", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/chat/webhook/meta", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/chat/webhook/uazapi", false)).toEqual({
        type: "allow",
      });
    });

    it("libera login e logout mesmo sem sessão", () => {
      expect(decideRouteAccess("/api/auth/login", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/auth/logout", false)).toEqual({
        type: "allow",
      });
    });

    it("libera a API de Integração (token próprio) mesmo sem sessão", () => {
      expect(decideRouteAccess("/api/integracao/leads", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/integracao/board", false)).toEqual({
        type: "allow",
      });
    });

    it("libera o worker Meta, que valida segredo próprio", () => {
      expect(decideRouteAccess("/api/internal/meta/dispatch", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/internal/meta/health", false)).toEqual({
        type: "allow",
      });
      expect(decideRouteAccess("/api/meta/conversions/123/retry", false)).toEqual({
        type: "allow",
      });
    });
  });

  describe("páginas protegidas", () => {
    it("redireciona para o login sem sessão, preservando o destino", () => {
      expect(decideRouteAccess("/app/leads", false)).toEqual({
        type: "redirect-login",
        redirectTo: "/app/leads",
      });
      expect(decideRouteAccess("/admin", false)).toEqual({
        type: "redirect-login",
        redirectTo: "/admin",
      });
    });

    it("libera com sessão válida", () => {
      expect(decideRouteAccess("/app/leads", true)).toEqual({ type: "allow" });
    });
  });

  describe("página de login", () => {
    it("redireciona para /app se já autenticado", () => {
      expect(decideRouteAccess("/login", true)).toEqual({ type: "redirect-app" });
    });

    it("libera o login sem sessão", () => {
      expect(decideRouteAccess("/login", false)).toEqual({ type: "allow" });
    });

    it("leva tráfego pago diretamente ao rastreamento", () => {
      expect(decideRouteAccess("/login", true, "paid_traffic")).toEqual({
        type: "redirect-tracking",
      });
    });
  });

  describe("páginas administrativas", () => {
    const adminPages = [
      "/app/rastreamento",
      "/app/conexao",
      "/app/equipe",
      "/app/configuracoes",
    ];

    it.each(adminPages)("libera %s para admin", (page) => {
      expect(decideRouteAccess(page, true, "admin")).toEqual({ type: "allow" });
    });

    it.each(adminPages)("redireciona %s para /app quando é member", (page) => {
      expect(decideRouteAccess(page, true, "member")).toEqual({ type: "redirect-app" });
    });

    it("também bloqueia uma sub-rota administrativa para member", () => {
      expect(decideRouteAccess("/app/equipe/qualquer", true, "member")).toEqual({
        type: "redirect-app",
      });
    });

    it("não confunde uma página não-administrativa", () => {
      expect(decideRouteAccess("/app/leads", true, "member")).toEqual({ type: "allow" });
    });

    it("sem sessão em página admin vai para login (não depende do papel)", () => {
      expect(decideRouteAccess("/app/equipe", false, null)).toEqual({
        type: "redirect-login",
        redirectTo: "/app/equipe",
      });
    });
  });

  describe("papel de tráfego pago", () => {
    it("libera apenas o rastreamento", () => {
      expect(
        decideRouteAccess("/app/rastreamento", true, "paid_traffic")
      ).toEqual({ type: "allow" });
      expect(
        decideRouteAccess("/app/rastreamento/detalhe", true, "paid_traffic")
      ).toEqual({ type: "allow" });
    });

    it.each([
      "/app",
      "/app/leads",
      "/app/funil",
      "/app/agendamentos",
      "/app/chat",
      "/app/follow-ups",
      "/app/perfil",
      "/app/conexao",
      "/app/equipe",
      "/app/configuracoes",
      "/admin",
    ])(
      "redireciona %s para Rastreamento",
      (page) => {
        expect(decideRouteAccess(page, true, "paid_traffic")).toEqual({
          type: "redirect-tracking",
        });
      }
    );

    it("permite concluir o primeiro acesso", () => {
      expect(decideRouteAccess("/definir-senha", true, "paid_traffic")).toEqual({
        type: "allow",
      });
    });
  });

  describe("isPublicApiRoute", () => {
    it("reconhece rotas públicas", () => {
      expect(isPublicApiRoute("/api/webhooks/n8n/lead")).toBe(true);
      expect(isPublicApiRoute("/api/chat/webhook/uazapi")).toBe(true);
      expect(isPublicApiRoute("/api/integracao/leads")).toBe(true);
      expect(isPublicApiRoute("/api/auth/login")).toBe(true);
      expect(isPublicApiRoute("/api/internal/meta/dispatch")).toBe(true);
      expect(isPublicApiRoute("/api/meta/conversions/123/retry")).toBe(true);
    });

    it("reconhece rotas internas como não-públicas", () => {
      expect(isPublicApiRoute("/api/leads/search")).toBe(false);
      expect(isPublicApiRoute("/api/tags")).toBe(false);
      expect(isPublicApiRoute("/api/financeiro/payments")).toBe(false);
    });
  });
});
