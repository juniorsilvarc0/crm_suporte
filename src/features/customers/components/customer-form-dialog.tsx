"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { customerCreateSchema } from "@/features/customers/schemas/customer";
import type { CustomerRecord } from "@/features/customers/types";
import { formatCnpj, isValidCnpj } from "@/lib/formatters/cnpj";

/** O que o formulário precisa da empresa para editar. Presente = edição. */
export type CustomerFormCustomer = Pick<
  CustomerRecord,
  "id" | "legal_name" | "trade_name" | "cnpj" | "notes"
>;

// O formulário valida com o schema de CRIAÇÃO nos dois modos. Na edição ele
// tem sempre os quatro campos, e para um objeto completo os dois schemas são a
// mesma regra (os mesmos campos; o de edição só os torna opcionais e exige ao
// menos um). O recorte que vai ao PATCH — só os dirtyFields — é validado de
// novo pela rota com o customerUpdateSchema. Um resolver por modo não compila:
// o `Resolver` do react-hook-form é invariante no tipo dos valores.
type CustomerFormValues = z.input<typeof customerCreateSchema>;
type CustomerFormOutput = z.output<typeof customerCreateSchema>;

const FORM_FIELDS = ["legal_name", "trade_name", "cnpj", "notes"] as const;

/** Respostas de POST /api/customers e PATCH /api/customers/[id]. */
type CustomerMutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
  /** 409 de CNPJ no POST: a empresa ATIVA que já tem o CNPJ. */
  existing?: { id?: string };
  customer?: { id?: string };
};

type CustomerFormDialogProps = {
  /** Presente = edição. Ausente = cadastro novo. */
  customer?: CustomerFormCustomer | null;
  /**
   * Controlado: quem chama tem o próprio botão. Sem `open`, o componente
   * desenha o gatilho ("Nova empresa" ou "Editar").
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Só para o gatilho próprio (ex.: empresa arquivada não é editada). */
  disabled?: boolean;
};

/**
 * Cadastro e edição da empresa — o mesmo formulário serve aos dois.
 *
 * react-hook-form + zodResolver com o schema compartilhado com a rota: o que o
 * formulário aceita é o que o servidor aceita. O que só o banco sabe (CNPJ já
 * usado por outra empresa ativa) volta da rota e é pintado no campo com
 * `setError`.
 */
export function CustomerFormDialog({
  customer = null,
  open: openProp,
  onOpenChange,
  disabled,
}: CustomerFormDialogProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;

  // Cada abertura é um formulário novo. O `Dialog` desmonta o conteúdo ao
  // fechar, mas o estado do react-hook-form mora no componente que o chama e
  // sobreviveria — com o erro e o rascunho da tentativa anterior. Ajuste
  // durante o render, mesmo padrão do primitivo `Dialog`.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((current) => current + 1);
  }

  function setOpen(next: boolean) {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  }

  const isEdit = Boolean(customer);

  return (
    <>
      {controlled ? null : (
        <Button
          type="button"
          variant={isEdit ? "outline" : "default"}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="h-11 sm:h-9"
        >
          {isEdit ? <PencilIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
          {isEdit ? "Editar" : "Nova empresa"}
        </Button>
      )}

      <CustomerForm
        key={`${customer?.id ?? "new"}:${session}`}
        customer={customer}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function CustomerForm({
  customer,
  open,
  onOpenChange,
}: {
  customer: CustomerFormCustomer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const id = (field: string) => `${fieldId}-${field}`;
  const [pending, setPending] = useState(false);
  // Trava de duplo envio: o `pending` só desabilita o botão no próximo render.
  const submitting = useRef(false);
  // 409 de CNPJ no cadastro: a ficha da empresa que já tem o CNPJ.
  const [existingId, setExistingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<CustomerFormValues, unknown, CustomerFormOutput>({
    resolver: zodResolver(customerCreateSchema),
    defaultValues: {
      legal_name: customer?.legal_name ?? "",
      trade_name: customer?.trade_name ?? "",
      cnpj: formatCnpj(customer?.cnpj),
      notes: customer?.notes ?? "",
    },
  });

  function handleOpenChange(next: boolean) {
    // O diálogo não fecha no meio do envio: a resposta ainda vai pintar erro
    // aqui, ou levar para a ficha da empresa criada.
    if (!next && submitting.current) return;
    onOpenChange(next);
  }

  async function onValid(values: CustomerFormOutput) {
    if (submitting.current) return;

    // Edição manda só o que mudou: ausente não apaga nada na rota, e salvar sem
    // mexer em um campo não o reescreve.
    const body = customer
      ? Object.fromEntries(
          FORM_FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, values[field]])
        )
      : values;

    if (customer && Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    submitting.current = true;
    setPending(true);
    setExistingId(null);

    const failure = customer
      ? "Não foi possível salvar a empresa."
      : "Não foi possível cadastrar a empresa.";

    try {
      const response = await fetch(customer ? `/api/customers/${customer.id}` : "/api/customers", {
        method: customer ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as CustomerMutationResponse;

      if (!response.ok || !result.ok) {
        const conflictId = response.status === 409 ? result.existing?.id : undefined;
        let marked = false;
        for (const field of FORM_FIELDS) {
          const message = result.errors?.[field]?.[0];
          if (!message) continue;
          setError(
            field,
            { type: field === "cnpj" && conflictId ? "conflict" : "server", message },
            { shouldFocus: !marked }
          );
          marked = true;
        }
        if (conflictId) setExistingId(conflictId);
        // Erro sem campo (sessão, empresa arquivada, falha do banco) vira toast;
        // erro de campo já aparece no campo, com `role="alert"`.
        if (!marked) toast.error(result.message ?? failure);
        return;
      }

      if (customer) {
        toast.success(result.message ?? "Empresa atualizada.");
        onOpenChange(false);
        router.refresh();
        return;
      }

      toast.success(result.message ?? "Empresa cadastrada.");
      onOpenChange(false);
      const createdId = result.customer?.id;
      if (createdId) router.push(`/app/clientes/${createdId}`);
      else router.refresh();
    } catch {
      toast.error(failure);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const cnpjField = register("cnpj", {
    // Formata no blur só quando o CNPJ é válido: com máscara num valor errado,
    // a pessoa perderia de vista o que digitou.
    onBlur: (event: { target: { value: string } }) => {
      const value = event.target.value;
      if (isValidCnpj(value) && formatCnpj(value) !== value) {
        setValue("cnpj", formatCnpj(value), { shouldDirty: true });
      }
    },
  });

  const cnpjConflict = errors.cnpj?.type === "conflict" && existingId;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ModalShell
        size="medium"
        title={customer ? "Editar empresa" : "Nova empresa"}
        description={
          customer ? undefined : "Contrato e contatos são ligados depois, na ficha da empresa."
        }
        // Dentro do handler, não no render: `handleSubmit(onValid)` no render
        // entrega ao React Compiler uma função que lê a trava (ref) de envio.
        onSubmit={(event) => void handleSubmit(onValid)(event)}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {customer ? "Salvar alterações" : "Cadastrar empresa"}
            </Button>
          </ModalFooterActions>
        }
      >
        <FieldGroup aria-busy={pending}>
          <Field>
            <FieldLabel htmlFor={id("legal_name")}>
              <span>
                Razão social<span className="text-primary" aria-hidden> *</span>
              </span>
            </FieldLabel>
            <Input
              id={id("legal_name")}
              autoComplete="off"
              maxLength={160}
              aria-required
              aria-invalid={errors.legal_name ? true : undefined}
              aria-describedby={errors.legal_name ? id("legal_name-error") : undefined}
              className="h-11 sm:h-10"
              {...register("legal_name")}
            />
            <FieldError id={id("legal_name-error")} className="text-xs">
              {errors.legal_name?.message}
            </FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor={id("trade_name")}>Nome fantasia</FieldLabel>
            <Input
              id={id("trade_name")}
              autoComplete="off"
              maxLength={160}
              aria-invalid={errors.trade_name ? true : undefined}
              aria-describedby={
                errors.trade_name ? id("trade_name-error") : id("trade_name-hint")
              }
              className="h-11 sm:h-10"
              {...register("trade_name")}
            />
            {errors.trade_name ? (
              <FieldError id={id("trade_name-error")} className="text-xs">
                {errors.trade_name.message}
              </FieldError>
            ) : (
              <FieldDescription id={id("trade_name-hint")} className="text-xs">
                Quando preenchido, é o nome que aparece no chat e nas listas.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={id("cnpj")}>CNPJ</FieldLabel>
            {/* ⚠️ Sem `inputMode="numeric"`: o teclado numérico esconderia as
                letras do CNPJ alfanumérico (IN RFB 2.229/2024). */}
            <Input
              id={id("cnpj")}
              placeholder="00.000.000/0000-00"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.cnpj ? true : undefined}
              aria-describedby={errors.cnpj ? id("cnpj-error") : id("cnpj-hint")}
              className="h-11 font-mono tabular-nums sm:h-10"
              {...cnpjField}
            />
            {errors.cnpj ? (
              <FieldError id={id("cnpj-error")} className="text-xs">
                {errors.cnpj.message}
                {cnpjConflict ? (
                  <>
                    {" "}
                    <Link
                      href={`/app/clientes/${existingId}`}
                      onClick={() => onOpenChange(false)}
                      className="font-medium underline underline-offset-4 hover:text-foreground"
                    >
                      Abrir empresa já cadastrada
                    </Link>
                  </>
                ) : null}
              </FieldError>
            ) : (
              <FieldDescription id={id("cnpj-hint")} className="text-xs">
                Opcional. Aceita CNPJ com letras.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={id("notes")}>Observações</FieldLabel>
            <Textarea
              id={id("notes")}
              maxLength={2000}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={errors.notes ? id("notes-error") : undefined}
              {...register("notes")}
            />
            <FieldError id={id("notes-error")} className="text-xs">
              {errors.notes?.message}
            </FieldError>
          </Field>
        </FieldGroup>
      </ModalShell>
    </Dialog>
  );
}
