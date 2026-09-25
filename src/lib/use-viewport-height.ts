"use client";

import { useLayoutEffect, type RefObject } from "react";

type ViewportGeometryInput = {
  visualHeight: number;
  baselineHeight: number;
  offsetTop: number;
  pageTop: number;
  scrollY: number;
  hasEditableFocus: boolean;
  scale: number;
  baselineScale: number;
};

type KeyboardViewportInput = Pick<
  ViewportGeometryInput,
  | "visualHeight"
  | "baselineHeight"
  | "hasEditableFocus"
  | "scale"
  | "baselineScale"
>;

type ViewportGeometry =
  | { keyboardOpen: false; height: null; top: 0 }
  | { keyboardOpen: true; height: number; top: number };

const VIEWPORT_EPSILON = 1;
const SCALE_EPSILON = 0.01;

export function isKeyboardViewportOpen({
  visualHeight,
  baselineHeight,
  hasEditableFocus,
  scale,
  baselineScale,
}: KeyboardViewportInput): boolean {
  return (
    hasEditableFocus &&
    Math.abs(scale - baselineScale) < SCALE_EPSILON &&
    visualHeight < baselineHeight - VIEWPORT_EPSILON
  );
}

export function resolveViewportGeometry({
  visualHeight,
  baselineHeight,
  offsetTop,
  pageTop,
  scrollY,
  hasEditableFocus,
  scale,
  baselineScale,
}: ViewportGeometryInput): ViewportGeometry {
  const keyboardOpen = isKeyboardViewportOpen({
    visualHeight,
    baselineHeight,
    hasEditableFocus,
    scale,
    baselineScale,
  });

  if (!keyboardOpen) {
    return { keyboardOpen: false, height: null, top: 0 };
  }

  return {
    keyboardOpen: true,
    height: Math.max(0, visualHeight),
    // `offsetTop` é o caminho normal. `pageTop - scrollY` cobre versões do
    // WebKit em que o primeiro valor chega atrasado durante o teclado.
    top: Math.max(0, offsetTop, pageTop - scrollY),
  };
}

function isEditableElement(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (!(element instanceof HTMLInputElement)) {
    return element instanceof HTMLElement && element.isContentEditable;
  }
  if (element.disabled || element.readOnly) return false;
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(element.type);
}

function resetDocumentScroll(): void {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function clearViewportGeometry(target: HTMLElement): void {
  target.style.removeProperty("--chat-vh");
  target.style.removeProperty("--chat-vtop");
  target.style.removeProperty("--chat-safe-bottom");
}

/**
 * Ajusta somente a superfície da conversa enquanto há um teclado real.
 *
 * Em PWA, `visualViewport.height` pode nascer permanentemente menor que
 * `100dvh` por causa da área segura. Por isso a referência é a altura visual
 * observada ao abrir a conversa, e não `documentElement.clientHeight`.
 * Sem foco editável + redução contra essa referência, o CSS continua dono da
 * geometria e nenhuma medida residual é publicada.
 */
export function useViewportHeight(
  active: boolean,
  targetRef: RefObject<HTMLElement | null>
) {
  useLayoutEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    if (!active) {
      clearViewportGeometry(target);
      resetDocumentScroll();
      return;
    }

    const vv = window.visualViewport;
    let baselineHeight = vv?.height ?? window.innerHeight;
    let baselineScale = vv?.scale ?? 1;
    let frame: number | undefined;
    let settleTimer: number | undefined;

    const apply = () => {
      const visualHeight = vv?.height ?? window.innerHeight;
      const scale = vv?.scale ?? 1;
      const editableFocus = isEditableElement(document.activeElement);

      // Fora do teclado, cada geometria estável passa a ser a nova referência.
      // Isso absorve rotação, barras do navegador e a altura menor do PWA.
      if (!editableFocus) {
        baselineHeight = visualHeight;
        baselineScale = scale;
      }

      const geometry = resolveViewportGeometry({
        visualHeight,
        baselineHeight,
        offsetTop: vv?.offsetTop ?? 0,
        pageTop: vv?.pageTop ?? window.scrollY,
        scrollY: window.scrollY,
        hasEditableFocus: editableFocus,
        scale,
        baselineScale,
      });

      if (!geometry.keyboardOpen) {
        clearViewportGeometry(target);
        resetDocumentScroll();
        return;
      }

      target.style.setProperty("--chat-vh", `${geometry.height}px`);
      target.style.setProperty("--chat-vtop", `${geometry.top}px`);
      // O WebKit mantém o inset inferior mesmo quando o teclado já ocupa a
      // área da barra de gestos.
      target.style.setProperty("--chat-safe-bottom", "0px");
    };

    const schedule = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);

      frame = window.requestAnimationFrame(apply);
      // Em modo PWA, algumas versões do WebKit estabilizam `offsetTop` apenas
      // depois do primeiro evento de viewport.
      settleTimer = window.setTimeout(apply, 100);
    };

    const handleOrientationChange = () => {
      clearViewportGeometry(target);
      const focused = document.activeElement;
      if (isEditableElement(focused) && focused instanceof HTMLElement) {
        focused.blur();
      }
      schedule();
    };

    apply();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    vv?.addEventListener("scrollend", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", handleOrientationChange);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);

    return () => {
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      vv?.removeEventListener("scrollend", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", handleOrientationChange);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      clearViewportGeometry(target);
      resetDocumentScroll();
    };
  }, [active, targetRef]);
}
