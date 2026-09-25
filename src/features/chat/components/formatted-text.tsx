import { Fragment } from "react";

import {
  parseWhatsappText,
  type FormattedNode,
} from "@/features/chat/lib/whatsapp-format";
import { MessagePhoneLink } from "@/features/chat/components/message-phone-link";
import { splitMessageEntities } from "@/features/chat/lib/message-content";
import { cn } from "@/lib/utils";

function renderPlainText(value: string, keyPrefix: string): React.ReactNode {
  return splitMessageEntities(value).map((entity, index) => {
    const key = `${keyPrefix}-entity-${index}`;
    if (entity.type === "url") {
      return (
        <a
          key={key}
          href={entity.href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--wa-green-deep)] underline decoration-current/60 underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {entity.value}
        </a>
      );
    }
    if (entity.type === "phone") {
      return <MessagePhoneLink key={key} value={entity.value} phone={entity.phone} />;
    }
    return <Fragment key={key}>{entity.value}</Fragment>;
  });
}

function renderNodes(
  nodes: FormattedNode[],
  keyPrefix = "",
  linkify = true
): React.ReactNode {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;

    switch (node.type) {
      case "text":
        return (
          <Fragment key={key}>
            {linkify ? renderPlainText(node.value, key) : node.value}
          </Fragment>
        );
      case "bold":
        return <strong key={key} className="font-semibold">{renderNodes(node.children, `${key}-`, linkify)}</strong>;
      case "italic":
        return <em key={key}>{renderNodes(node.children, `${key}-`, linkify)}</em>;
      case "strike":
        return <s key={key}>{renderNodes(node.children, `${key}-`, linkify)}</s>;
      case "mono":
        return (
          <code key={key} className="rounded-sm bg-black/5 px-1 font-mono text-[0.9em] dark:bg-white/10">
            {renderNodes(node.children, `${key}-`, false)}
          </code>
        );
      case "block":
        return (
          <code
            key={key}
            className="block whitespace-pre-wrap rounded-sm bg-black/5 px-1.5 py-1 font-mono text-[0.9em] dark:bg-white/10"
          >
            {node.value}
          </code>
        );
    }
  });
}

/**
 * Texto de mensagem com a formatação do WhatsApp aplicada.
 *
 * Nós React, nunca `dangerouslySetInnerHTML`: o conteúdo chega pela API do
 * WhatsApp, escrito por quem estiver do outro lado.
 */
export function FormattedText({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <span className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", className)}>
      {renderNodes(parseWhatsappText(content))}
    </span>
  );
}
