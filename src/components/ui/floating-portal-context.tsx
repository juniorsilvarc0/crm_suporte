"use client";

import { createContext, useContext, type RefObject } from "react";

type FloatingPortalContainer = RefObject<HTMLElement | null> | undefined;

const FloatingPortalContainerContext = createContext<FloatingPortalContainer>(undefined);

const FloatingPortalContainerProvider = FloatingPortalContainerContext.Provider;

function useFloatingPortalContainer() {
  return useContext(FloatingPortalContainerContext);
}

export { FloatingPortalContainerProvider, useFloatingPortalContainer };
