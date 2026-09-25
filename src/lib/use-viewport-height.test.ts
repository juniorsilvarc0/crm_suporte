import { describe, expect, it } from "vitest";

import {
  isKeyboardViewportOpen,
  resolveViewportGeometry,
} from "@/lib/use-viewport-height";

const baseGeometry = {
  visualHeight: 785,
  baselineHeight: 785,
  offsetTop: 0,
  pageTop: 0,
  scrollY: 0,
  hasEditableFocus: false,
  scale: 1,
  baselineScale: 1,
};

describe("resolveViewportGeometry", () => {
  it("não deve tratar a altura menor permanente do PWA como teclado", () => {
    expect(resolveViewportGeometry(baseGeometry)).toEqual({
      keyboardOpen: false,
      height: null,
      top: 0,
    });
  });

  it("não deve abrir o modo teclado antes de a viewport encolher", () => {
    expect(
      resolveViewportGeometry({
        ...baseGeometry,
        hasEditableFocus: true,
      })
    ).toEqual({ keyboardOpen: false, height: null, top: 0 });
  });

  it("deve acompanhar altura e deslocamento enquanto o teclado está aberto", () => {
    expect(
      resolveViewportGeometry({
        ...baseGeometry,
        visualHeight: 420,
        offsetTop: 286,
        pageTop: 286,
        hasEditableFocus: true,
      })
    ).toEqual({ keyboardOpen: true, height: 420, top: 286 });
  });

  it("deve usar pageTop quando o WebKit informa offsetTop atrasado", () => {
    expect(
      resolveViewportGeometry({
        ...baseGeometry,
        visualHeight: 420,
        pageTop: 386,
        scrollY: 100,
        hasEditableFocus: true,
      })
    ).toEqual({ keyboardOpen: true, height: 420, top: 286 });
  });

  it("deve descartar altura e deslocamento residuais depois do blur", () => {
    expect(
      resolveViewportGeometry({
        ...baseGeometry,
        visualHeight: 420,
        offsetTop: 84,
        pageTop: 84,
      })
    ).toEqual({ keyboardOpen: false, height: null, top: 0 });
  });

  it("não deve confundir zoom com teclado mesmo com campo editável focado", () => {
    expect(
      resolveViewportGeometry({
        ...baseGeometry,
        visualHeight: 420,
        hasEditableFocus: true,
        scale: 1.5,
      })
    ).toEqual({ keyboardOpen: false, height: null, top: 0 });
  });
});

describe("isKeyboardViewportOpen", () => {
  it("deve exigir foco editável, redução contra a linha de base e escala estável", () => {
    expect(
      isKeyboardViewportOpen({
        visualHeight: 420,
        baselineHeight: 785,
        hasEditableFocus: true,
        scale: 1,
        baselineScale: 1,
      })
    ).toBe(true);

    expect(
      isKeyboardViewportOpen({
        visualHeight: 420,
        baselineHeight: 785,
        hasEditableFocus: false,
        scale: 1,
        baselineScale: 1,
      })
    ).toBe(false);

    expect(
      isKeyboardViewportOpen({
        visualHeight: 420,
        baselineHeight: 785,
        hasEditableFocus: true,
        scale: 1.5,
        baselineScale: 1,
      })
    ).toBe(false);
  });
});
