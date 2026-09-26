"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { ModalShell } from "@/components/layout/modal-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { linkContactToCustomer } from "@/features/contacts/lib/link-customer";
import type { ContactListItem } from "@/features/contacts/types";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import { customerDisplayName } from "@/features/customers/lib/customer-display";
import type { CustomerSummary } from "@/features/customers/types";
import { formatPhone } from "@/lib/formatters/phone";

/**
 * Vincular (ou trocar) a empresa de um contato, a partir da lista de Contatos.
 *
 * O seletor é o mesmo do painel do contato no chat (`CustomerPicker`), aqui
 * dentro de um diálogo. A escrita é o PATCH do contato, pelo mesmo caminho dos
 * outros dois chamadores (`linkContactToCustomer`).
 *
 * Quem monta mantém `contact` depois de fechar (dois estados, `open` e o
 * contato): se o contato fosse zerado junto, o conteúdo sumiria no meio da
 * animação de saída.
 */
export function LinkCustomerDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: ContactListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Só a recusa da empresa (422) fica no diálogo: é sobre a escolha que a
  // pessoa acabou de fazer. Falha de rede ou de servidor vai para o toast.
  const [error, setError] = useState<string | null>(null);

  // Erro da tentativa anterior não sobrevive a reabrir o diálogo. Ajuste
  // durante o render: o diálogo fica montado entre uma abertura e outra.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setError(null);
  }

  async function pick(customer: CustomerSummary) {
    if (!contact || busyId) return;
    setBusyId(customer.id);
    setError(null);
    const result = await linkContactToCustomer(contact.id, customer.id);
    setBusyId(null);

    if (!result.ok) {
      if (result.status === 422) setError(result.message);
      else toast.error(result.message);
      return;
    }

    toast.success(`Contato vinculado a ${customerDisplayName(customer)}.`);
    router.refresh();
    onOpenChange(false);
  }

  const contactLabel = contact ? contact.name?.trim() || formatPhone(contact.phone) : "";
  const current = contact?.customer ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Não fecha com a escrita no ar: o resultado chegaria sem ninguém
        // para ver o erro.
        if (!next && busyId) return;
        onOpenChange(next);
      }}
    >
      {contact ? (
        <ModalShell
          size="compact"
          title={
            current
              ? `Trocar a empresa de ${contactLabel}`
              : `Vincular ${contactLabel} a uma empresa`
          }
          description="Só empresas ativas aparecem na busca."
        >
          <div className="grid gap-3">
            {error ? (
              <Alert variant="destructive" className="text-left">
                <TriangleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <CustomerPicker
              appearance="app"
              currentCustomerId={current?.id ?? null}
              currentCustomerName={current ? customerDisplayName(current) : null}
              busyId={busyId}
              onPick={(customer) => void pick(customer)}
            />
          </div>
        </ModalShell>
      ) : null}
    </Dialog>
  );
}
