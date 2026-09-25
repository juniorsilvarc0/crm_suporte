"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * `variant="cards"` — casca 3.0: a lista deixa de ser grade de linhas coladas e
 * cada registro vira um cartão. As linhas se afastam por `border-spacing`, e o
 * cartão é desenhado nas CÉLULAS pelo `TableRow variant="card"`, porque `<tr>`
 * não aceita raio nem borda de forma confiável. Use com um contêiner de leito
 * tingido (ver UI.md §3.3, "cartão de pessoa").
 */
function Table({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"table"> & { variant?: "default" | "cards" }) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-variant={variant}
        className={cn(
          "w-full caption-bottom text-sm",
          variant === "cards" && "border-separate border-spacing-y-2",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"tr"> & { variant?: "default" | "card" | "cards-header" }) {
  return (
    <tr
      data-slot="table-row"
      data-variant={variant}
      className={cn(
        variant === "default" &&
          "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        // Cabeçalho de tabela em cartões: sem régua, flutuando acima da pilha.
        variant === "cards-header" && "border-b-0 hover:bg-transparent [&>th]:border-b-0",
        variant === "card" && [
          "border-b-0 transition-colors hover:bg-transparent",
          "[&>td]:border-y [&>td]:border-border/70 [&>td]:bg-card [&>td]:transition-colors",
          "[&>td:first-child]:rounded-l-xl [&>td:first-child]:border-l",
          "[&>td:last-child]:rounded-r-xl [&>td:last-child]:border-r",
          "hover:[&>td]:bg-muted/40",
        ],
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
