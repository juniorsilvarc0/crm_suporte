"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Em desenvolvimento NÃO registra o SW — e remove qualquer um já instalado +
    // limpa caches, senão o SW serve bundles antigos (erros que "sobrevivem" a
    // restart do dev server). SW só em produção.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
      if (typeof caches !== "undefined") {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }
      return;
    }

    const controller = new AbortController();

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        const checkForUpdate = () => {
          registration.update().catch(() => {
            /* ignore network errors */
          });
        };

        window.addEventListener("focus", checkForUpdate, {
          signal: controller.signal,
        });
        document.addEventListener(
          "visibilitychange",
          () => {
            if (document.visibilityState === "visible") checkForUpdate();
          },
          { signal: controller.signal }
        );
      } catch (error) {
        console.warn("[PWA] Service worker registration failed:", error);
      }
    };

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );

    void register();

    return () => {
      controller.abort();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, []);

  return null;
}
