import type { ReactNode } from "react";

export function PageHeader({
  title,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="contents">
      <h1 className="sr-only">{title}</h1>
      {actions ? (
        <div className="flex shrink-0 items-center justify-end gap-2 bg-transparent px-4 pt-4 sm:px-6 lg:px-8">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
