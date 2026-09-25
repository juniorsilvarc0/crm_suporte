import type { MessageDirection } from "@/features/chat/types";

export type AnchorRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const EDGE = 18;
const GAP = 10;
const PANEL_MAX_WIDTH = 264;
const MESSAGE_MAX_VIEWPORT_RATIO = 0.45;

export function getMessageContextLayout({
  anchor,
  direction,
  panelHeight,
  viewportHeight,
  viewportWidth,
}: {
  anchor: AnchorRect;
  direction: MessageDirection;
  panelHeight: number;
  viewportHeight: number;
  viewportWidth: number;
}) {
  const availableWidth = Math.min(anchor.width, viewportWidth);
  const panelWidth = Math.max(
    0,
    Math.min(PANEL_MAX_WIDTH, availableWidth - EDGE * 2)
  );
  const panelLeft =
    direction === "outbound"
      ? availableWidth - panelWidth - EDGE
      : EDGE;
  const availableHeight = Math.max(0, viewportHeight - EDGE * 2);
  const preferredMessageHeight = Math.min(
    anchor.height,
    Math.floor(availableHeight * MESSAGE_MAX_VIEWPORT_RATIO)
  );
  const panelMaxHeight = Math.max(
    0,
    availableHeight - GAP - preferredMessageHeight
  );
  const visiblePanelHeight = Math.min(panelHeight, panelMaxHeight);
  const messageHeight = Math.max(
    0,
    Math.min(
      preferredMessageHeight,
      availableHeight - GAP - visiblePanelHeight
    )
  );
  const lastClusterTop = Math.max(
    EDGE,
    viewportHeight - EDGE - messageHeight - GAP - visiblePanelHeight
  );

  return {
    clusterTop: Math.min(Math.max(EDGE, anchor.top), lastClusterTop),
    messageHeight,
    panelMaxHeight,
    panelLeft,
    panelWidth,
  };
}

export const MESSAGE_CONTEXT_GAP = GAP;
export const MESSAGE_CONTEXT_EDGE = EDGE;
