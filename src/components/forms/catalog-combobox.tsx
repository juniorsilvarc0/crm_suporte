"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ChevronsUpDownIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  buildCatalogEntries,
  isSameCatalogEntry,
  parseCreatedCatalogItem,
  toCatalogEntry,
  toCatalogOption,
  type CatalogEntry,
  type CatalogOption,
} from "@/components/forms/catalog-options";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { getColorStyle } from "@/features/tags/schemas/colors";
import { cn } from "@/lib/utils";

type CommonProps = {
  id: string;
  /** Catálogo ATIVO, vindo do servidor por prop; revalida com `router.refresh()`. */
  options: readonly CatalogOption[];
  /**
   * Rota POST que cria pelo nome (`{ name }`) e devolve `item` — também no 409
   * de nome repetido. Passe só para admin: sem ela não existe "Criar «X»".
   */
  createUrl?: string;
  placeholder?: string;
  /** Frase do catálogo vazio, ex.: "Nenhum produto cadastrado." */
  emptyText?: string;
  /** Rótulo da seta que abre a lista (leitor de tela). */
  triggerLabel?: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
};

type SingleProps = CommonProps & {
  /** Um valor só (ex.: plano). Sem `required`, dá para limpar. */
  mode: "single";
  value: CatalogOption | null;
  onChange: (option: CatalogOption | null) => void;
};

type AdderProps = CommonProps & {
  /** Acrescenta a uma lista que quem chama desenha (ex.: chips de produtos). */
  mode: "adder";
  /** Os já escolhidos: saem da lista e contam como "já existe" para o Criar. */
  chosen: readonly CatalogOption[];
  onAdd: (option: CatalogOption) => void;
};

type CreateResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
  item?: unknown;
};

const CREATE_FAILED = "Não foi possível criar o item.";

/**
 * Campo de catálogo: filtra, escolhe e, para admin, cria na hora.
 *
 * O valor é um OBJETO com id (`CatalogOption`), mostrado pelo nome
 * (`itemToStringLabel`) e comparado pelo id (`isItemEqualToValue`) — o UUID
 * nunca aparece no campo, e um objeto recriado a cada render não "desmarca" o
 * item.
 *
 * Item e "Criar «X»" passam pelo MESMO caminho (`onValueChange`); não há
 * `onClick` paralelo no item, que disparava duas vezes no teclado. Arquivar
 * não mora aqui: a gestão do catálogo tem tela própria.
 *
 * O popup é o `ComboboxPopup`, que já porta no contêiner da gaveta quando o
 * formulário vira gaveta no celular (UI.md §5.10).
 */
export function CatalogCombobox(props: SingleProps | AdderProps) {
  const {
    id,
    options,
    createUrl,
    placeholder,
    emptyText,
    triggerLabel = "Abrir lista",
    required,
    invalid,
    describedBy,
    disabled,
  } = props;
  const router = useRouter();
  const [term, setTerm] = useState("");
  // Só o modo "adder" controla o texto do campo: ao acrescentar, ele esvazia na
  // hora para o próximo item. No "single", o Base UI sincroniza o campo com o
  // nome do valor escolhido.
  const [adderText, setAdderText] = useState("");
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);

  const single = props.mode === "single" ? props.value : null;
  const chosen = props.mode === "adder" ? props.chosen : null;

  // ⚠️ Referência estável: o Base UI compara o valor por `===` para sincronizar
  // o texto do campo. Um objeto novo a cada render reescreveria o que a pessoa
  // está digitando com o nome do valor atual.
  const selectedId = single?.id;
  const selectedName = single?.name;
  const selectedColor = single?.color;
  const selectedHint = single?.hint;
  const selectedArchived = single?.archived;
  const selectedEntry = useMemo<CatalogEntry | null>(
    () =>
      selectedId !== undefined && selectedName !== undefined
        ? toCatalogEntry({
            id: selectedId,
            name: selectedName,
            color: selectedColor,
            hint: selectedHint,
            archived: selectedArchived,
          })
        : null,
    [selectedId, selectedName, selectedColor, selectedHint, selectedArchived]
  );

  const canCreate = Boolean(createUrl);
  const entries = useMemo(
    () =>
      buildCatalogEntries({
        options,
        term,
        selected: single,
        chosen: chosen ?? [],
        canCreate,
      }),
    [options, term, single, chosen, canCreate]
  );

  function commit(option: CatalogOption) {
    if (props.mode === "single") {
      props.onChange(option);
      return;
    }
    setAdderText("");
    setTerm("");
    // Criado (ou devolvido pelo 409) e já escolhido: nada a acrescentar.
    if (props.chosen.some((current) => current.id === option.id)) return;
    props.onAdd(option);
  }

  async function create(name: string) {
    if (!createUrl || inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    try {
      const response = await fetch(createUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => null)) as CreateResponse | null;
      const item = parseCreatedCatalogItem(payload?.item);

      // 409 com o item = o nome já existe (outra aba, outra pessoa). Não é erro
      // de quem digitou: escolhe o que já existe e segue.
      if (item && ((response.ok && payload?.ok) || response.status === 409)) {
        commit(item);
        router.refresh();
        return;
      }
      toast.error(payload?.errors?.name?.[0] ?? payload?.message ?? CREATE_FAILED);
    } catch {
      toast.error(CREATE_FAILED);
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  }

  function handleValueChange(
    next: CatalogEntry | null,
    details: ComboboxPrimitive.Root.ChangeEventDetails
  ) {
    if (next === null) {
      // Campo apagado ou botão de limpar: só o modo "single" tem valor.
      if (props.mode === "single") props.onChange(null);
      return;
    }
    if (next.kind === "create") {
      // O campo não vira "Criar X": quem decide o valor é a resposta da rota.
      details.cancel();
      void create(next.name);
      return;
    }
    if (props.mode === "single") {
      props.onChange(toCatalogOption(next));
      return;
    }
    // "adder": o item vira chip fora do campo, que não guarda valor.
    details.cancel();
    commit(toCatalogOption(next));
  }

  const clearable = props.mode === "single" && !required;
  const chosenIds = new Set((chosen ?? []).map((option) => option.id));
  const allChosen =
    chosen !== null && options.length > 0 && options.every((option) => chosenIds.has(option.id));

  let emptyMessage: string;
  if (options.length === 0 && !term.trim()) {
    emptyMessage = `${emptyText ?? "Nada cadastrado ainda."}${canCreate ? " Digite para criar." : ""}`;
  } else if (allChosen && !term.trim()) {
    emptyMessage = "Todos já foram incluídos.";
  } else {
    emptyMessage = canCreate
      ? "Nada encontrado. Digite ao menos 2 letras para criar."
      : "Nada encontrado.";
  }

  return (
    <div className="relative">
      <Combobox<CatalogEntry>
        value={props.mode === "single" ? selectedEntry : null}
        onValueChange={handleValueChange}
        inputValue={props.mode === "adder" ? adderText : undefined}
        // Só o que a pessoa DIGITA filtra. Quando o Base UI preenche o campo
        // com o nome escolhido (ou o limpa ao fechar), a lista volta inteira.
        onInputValueChange={(next, details) => {
          if (props.mode === "adder") setAdderText(next);
          setTerm(details.reason === "input-change" ? next : "");
        }}
        itemToStringLabel={(entry) => entry.name}
        isItemEqualToValue={isSameCatalogEntry}
        openOnInputClick
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          // Espaço da seta (2,25rem) e, quando limpável, do X (44px no toque).
          className={clearable ? "pe-20 sm:pe-17" : "pe-9"}
          placeholder={placeholder ?? (canCreate ? "Busque ou crie" : "Busque na lista")}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-busy={creating || undefined}
        />
        {clearable ? (
          // Sai da ordem de Tab (padrão do Base UI): no teclado, apagar o
          // texto do campo já limpa o valor.
          <ComboboxPrimitive.Clear
            aria-label="Limpar"
            className="absolute inset-y-0 end-9 flex w-11 items-center justify-center text-muted-foreground outline-none transition-colors hover:text-foreground sm:w-8"
          >
            <XIcon className="size-4" aria-hidden />
          </ComboboxPrimitive.Clear>
        ) : null}
        <ComboboxTrigger aria-label={triggerLabel}>
          {creating ? (
            <Loader2Icon className="size-4 animate-spin" aria-hidden />
          ) : (
            <ChevronsUpDownIcon className="size-4" aria-hidden />
          )}
        </ComboboxTrigger>

        <ComboboxPopup>
          {entries.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <ComboboxList>
              {entries.map((entry) =>
                entry.kind === "create" ? (
                  <ComboboxItem
                    key={`create:${entry.name}`}
                    value={entry}
                    disabled={creating}
                    className="text-primary"
                  >
                    <PlusIcon className="size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">Criar «{entry.name}»</span>
                  </ComboboxItem>
                ) : (
                  <ComboboxItem key={entry.id} value={entry}>
                    {entry.color ? (
                      <span
                        aria-hidden
                        className={cn("size-2.5 shrink-0 rounded-full", getColorStyle(entry.color).dot)}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.archived ? (
                      <span className="shrink-0 text-xs text-muted-foreground">(arquivado)</span>
                    ) : null}
                    {entry.hint ? (
                      <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                        {entry.hint}
                      </span>
                    ) : null}
                  </ComboboxItem>
                )
              )}
            </ComboboxList>
          )}
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
