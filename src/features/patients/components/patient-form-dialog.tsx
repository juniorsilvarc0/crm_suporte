"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  HeartPulseIcon,
  Loader2Icon,
  MapPinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCpf, formatZipCode } from "@/features/patients/lib/documents";
import {
  BLOOD_TYPES,
  MARITAL_STATUS,
  PATIENT_SEX,
  maritalStatusLabel,
  patientSexLabel,
  type Patient,
} from "@/features/patients/types";
import { cn } from "@/lib/utils";

type PatientFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente = edição. Ausente = cadastro novo. */
  patient?: Patient | null;
  /** Lead de origem, quando o cadastro nasce de um contato já existente. */
  leadId?: string | null;
  defaultName?: string | null;
  defaultPhone?: string | null;
  onSaved?: (patientId: string) => void;
};

/** Resposta das rotas de paciente. `patient.id` é o caminho esperado no POST. */
type PatientMutationResponse = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  patient?: { id?: string } | null;
  id?: string;
};

/**
 * Cadastro completo do paciente — o mesmo formulário serve para criar e editar.
 *
 * São seis blocos de dados que quase nunca são preenchidos de uma vez: quem
 * cadastra na recepção tem nome e telefone, o resto chega na consulta. Por isso
 * só o nome é obrigatório aqui — a validação real, campo a campo, é do servidor
 * (`createPatientSchema` / `updatePatientSchema`), e volta pintada por campo.
 */
export function PatientFormDialog({
  open,
  onOpenChange,
  patient,
  leadId,
  defaultName,
  defaultPhone,
  onSaved,
}: PatientFormDialogProps) {
  const router = useRouter();
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const submitting = useRef(false);

  // Erro de uma tentativa anterior não pode sobreviver ao fechamento do modal:
  // o corpo desmonta com o diálogo, mas este componente permanece montado.
  // Ajuste durante o render — mesmo padrão do primitivo `Dialog`.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setErrors({});
  }

  const isEdit = Boolean(patient);
  const id = (field: string) => `${fieldId}-${field}`;
  const errorId = (field: string) => (errors[field] ? `${id(field)}-error` : undefined);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setErrors({});

    const payload = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const response = await fetch(
        patient ? `/api/patients/${patient.id}` : "/api/patients",
        {
          method: patient ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const result = (await response
        .json()
        .catch(() => ({}))) as PatientMutationResponse;

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível salvar o paciente.");
        return;
      }

      toast.success(result.message ?? (patient ? "Paciente atualizado." : "Paciente cadastrado."));
      router.refresh();
      onOpenChange(false);

      const savedId = patient?.id ?? result.patient?.id ?? result.id;
      if (savedId) onSaved?.(savedId);
    } catch {
      toast.error("Não foi possível salvar o paciente.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ModalShell
        size="wide"
        title={isEdit ? "Editar paciente" : "Novo paciente"}
        description={
          isEdit
            ? "As alterações valem para a agenda, o atendimento e o convênio."
            : leadId
              ? "O cadastro nasce deste lead e passa a compartilhar o histórico dele."
              : "Só o nome é obrigatório — o resto pode ser completado depois."
        }
        onSubmit={handleSubmit}
        footer={
          <ModalFooterActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="h-11 sm:h-9"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="h-11 sm:h-9">
              {pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}
              {isEdit ? "Salvar alterações" : "Cadastrar paciente"}
            </Button>
          </ModalFooterActions>
        }
      >
        {/* Trocar de paciente com o modal aberto precisa refazer os campos:
            `defaultValue` só é lido na montagem. */}
        <div key={patient?.id ?? "new"} className="mx-auto w-full max-w-4xl">
          {!isEdit && leadId ? <input type="hidden" name="lead_id" value={leadId} /> : null}

          <FormSection
            icon={<UserRoundIcon />}
            title="Identificação"
            description="Quem é a pessoa e os documentos que o convênio exige."
          >
            <FieldGrid>
              <FormField
                htmlFor={id("full_name")}
                label="Nome completo"
                error={errors.full_name?.[0]}
                required
                className="sm:col-span-4"
              >
                <Input
                  id={id("full_name")}
                  name="full_name"
                  autoComplete="name"
                  required
                  placeholder="Ex.: Maria Souza Lima"
                  defaultValue={patient?.full_name ?? defaultName ?? ""}
                  aria-invalid={Boolean(errors.full_name)}
                  aria-describedby={errorId("full_name")}
                />
              </FormField>

              <FormField
                htmlFor={id("social_name")}
                label="Nome social"
                error={errors.social_name?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("social_name")}
                  name="social_name"
                  placeholder="Como prefere ser chamada"
                  defaultValue={patient?.social_name ?? ""}
                  aria-invalid={Boolean(errors.social_name)}
                  aria-describedby={errorId("social_name")}
                />
              </FormField>

              <FormField
                htmlFor={id("birth_date")}
                label="Data de nascimento"
                error={errors.birth_date?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("birth_date")}
                  name="birth_date"
                  type="date"
                  defaultValue={patient?.birth_date ?? ""}
                  aria-invalid={Boolean(errors.birth_date)}
                  aria-describedby={errorId("birth_date")}
                />
              </FormField>

              <FormField
                htmlFor={id("sex")}
                label="Sexo"
                error={errors.sex?.[0]}
                className="sm:col-span-2"
              >
                <FormSelect
                  id={id("sex")}
                  name="sex"
                  defaultValue={patient?.sex ?? ""}
                  emptyLabel="Selecione"
                  aria-invalid={Boolean(errors.sex)}
                  aria-describedby={errorId("sex")}
                  options={PATIENT_SEX.map((value) => ({
                    value,
                    label: patientSexLabel[value],
                  }))}
                />
              </FormField>

              <FormField
                htmlFor={id("marital_status")}
                label="Estado civil"
                error={errors.marital_status?.[0]}
                className="sm:col-span-2"
              >
                <FormSelect
                  id={id("marital_status")}
                  name="marital_status"
                  defaultValue={patient?.marital_status ?? ""}
                  emptyLabel="Selecione"
                  aria-invalid={Boolean(errors.marital_status)}
                  aria-describedby={errorId("marital_status")}
                  options={MARITAL_STATUS.map((value) => ({
                    value,
                    label: maritalStatusLabel[value] ?? value,
                  }))}
                />
              </FormField>

              <FormField
                htmlFor={id("cpf")}
                label="CPF"
                error={errors.cpf?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("cpf")}
                  name="cpf"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  defaultValue={patient?.cpf ? formatCpf(patient.cpf) : ""}
                  aria-invalid={Boolean(errors.cpf)}
                  aria-describedby={errorId("cpf")}
                />
              </FormField>

              <FormField
                htmlFor={id("rg")}
                label="RG"
                error={errors.rg?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("rg")}
                  name="rg"
                  placeholder="Número e órgão emissor"
                  defaultValue={patient?.rg ?? ""}
                  aria-invalid={Boolean(errors.rg)}
                  aria-describedby={errorId("rg")}
                />
              </FormField>

              <FormField
                htmlFor={id("occupation")}
                label="Profissão"
                error={errors.occupation?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("occupation")}
                  name="occupation"
                  placeholder="Ex.: Professora"
                  defaultValue={patient?.occupation ?? ""}
                  aria-invalid={Boolean(errors.occupation)}
                  aria-describedby={errorId("occupation")}
                />
              </FormField>

              <FormField
                htmlFor={id("nationality")}
                label="Nacionalidade"
                error={errors.nationality?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("nationality")}
                  name="nationality"
                  placeholder="Ex.: Brasileira"
                  defaultValue={patient?.nationality ?? ""}
                  aria-invalid={Boolean(errors.nationality)}
                  aria-describedby={errorId("nationality")}
                />
              </FormField>

              <FormField
                htmlFor={id("birthplace")}
                label="Naturalidade"
                error={errors.birthplace?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("birthplace")}
                  name="birthplace"
                  placeholder="Cidade de nascimento"
                  defaultValue={patient?.birthplace ?? ""}
                  aria-invalid={Boolean(errors.birthplace)}
                  aria-describedby={errorId("birthplace")}
                />
              </FormField>
            </FieldGrid>
          </FormSection>

          <FormSection
            icon={<PhoneIcon />}
            title="Contato"
            description="Por onde a clínica avisa consulta, resultado e retorno."
          >
            <FieldGrid>
              <FormField
                htmlFor={id("phone")}
                label="Telefone"
                error={errors.phone?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("phone")}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(00) 00000-0000"
                  defaultValue={patient?.phone ?? defaultPhone ?? ""}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errorId("phone")}
                />
              </FormField>

              <FormField
                htmlFor={id("phone_alt")}
                label="Telefone alternativo"
                error={errors.phone_alt?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("phone_alt")}
                  name="phone_alt"
                  type="tel"
                  inputMode="tel"
                  placeholder="(00) 0000-0000"
                  defaultValue={patient?.phone_alt ?? ""}
                  aria-invalid={Boolean(errors.phone_alt)}
                  aria-describedby={errorId("phone_alt")}
                />
              </FormField>

              <FormField
                htmlFor={id("email")}
                label="E-mail"
                error={errors.email?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("email")}
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nome@email.com"
                  defaultValue={patient?.email ?? ""}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errorId("email")}
                />
              </FormField>
            </FieldGrid>
          </FormSection>

          <FormSection
            icon={<MapPinIcon />}
            title="Endereço"
            description="Usado em guias de convênio e documentos impressos."
          >
            <FieldGrid>
              <FormField
                htmlFor={id("zip_code")}
                label="CEP"
                error={errors.zip_code?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("zip_code")}
                  name="zip_code"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="00000-000"
                  defaultValue={patient?.zip_code ? formatZipCode(patient.zip_code) : ""}
                  aria-invalid={Boolean(errors.zip_code)}
                  aria-describedby={errorId("zip_code")}
                />
              </FormField>

              <FormField
                htmlFor={id("street")}
                label="Logradouro"
                error={errors.street?.[0]}
                className="sm:col-span-4"
              >
                <Input
                  id={id("street")}
                  name="street"
                  autoComplete="address-line1"
                  placeholder="Rua, avenida, travessa..."
                  defaultValue={patient?.street ?? ""}
                  aria-invalid={Boolean(errors.street)}
                  aria-describedby={errorId("street")}
                />
              </FormField>

              <FormField
                htmlFor={id("street_number")}
                label="Número"
                error={errors.street_number?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("street_number")}
                  name="street_number"
                  placeholder="123"
                  defaultValue={patient?.street_number ?? ""}
                  aria-invalid={Boolean(errors.street_number)}
                  aria-describedby={errorId("street_number")}
                />
              </FormField>

              <FormField
                htmlFor={id("complement")}
                label="Complemento"
                error={errors.complement?.[0]}
                className="sm:col-span-4"
              >
                <Input
                  id={id("complement")}
                  name="complement"
                  autoComplete="address-line2"
                  placeholder="Apto, bloco, referência"
                  defaultValue={patient?.complement ?? ""}
                  aria-invalid={Boolean(errors.complement)}
                  aria-describedby={errorId("complement")}
                />
              </FormField>

              <FormField
                htmlFor={id("district")}
                label="Bairro"
                error={errors.district?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("district")}
                  name="district"
                  placeholder="Ex.: Centro"
                  defaultValue={patient?.district ?? ""}
                  aria-invalid={Boolean(errors.district)}
                  aria-describedby={errorId("district")}
                />
              </FormField>

              <FormField
                htmlFor={id("city")}
                label="Cidade"
                error={errors.city?.[0]}
                className="sm:col-span-2"
              >
                <Input
                  id={id("city")}
                  name="city"
                  placeholder="Ex.: Vitória"
                  defaultValue={patient?.city ?? ""}
                  aria-invalid={Boolean(errors.city)}
                  aria-describedby={errorId("city")}
                />
              </FormField>

              <FormField
                htmlFor={id("state")}
                label="UF"
                error={errors.state?.[0]}
                className="sm:col-span-1"
              >
                <Input
                  id={id("state")}
                  name="state"
                  maxLength={2}
                  placeholder="ES"
                  className="uppercase"
                  defaultValue={patient?.state ?? ""}
                  aria-invalid={Boolean(errors.state)}
                  aria-describedby={errorId("state")}
                />
              </FormField>
            </FieldGrid>
          </FormSection>

          <FormSection
            icon={<UsersRoundIcon />}
            title="Filiação e responsável"
            description="Obrigatório para menores de idade e para quem não assina sozinho."
          >
            <FieldGrid>
              <FormField
                htmlFor={id("mother_name")}
                label="Nome da mãe"
                error={errors.mother_name?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("mother_name")}
                  name="mother_name"
                  placeholder="Nome completo"
                  defaultValue={patient?.mother_name ?? ""}
                  aria-invalid={Boolean(errors.mother_name)}
                  aria-describedby={errorId("mother_name")}
                />
              </FormField>

              <FormField
                htmlFor={id("father_name")}
                label="Nome do pai"
                error={errors.father_name?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("father_name")}
                  name="father_name"
                  placeholder="Nome completo"
                  defaultValue={patient?.father_name ?? ""}
                  aria-invalid={Boolean(errors.father_name)}
                  aria-describedby={errorId("father_name")}
                />
              </FormField>

              <FormField
                htmlFor={id("guardian_name")}
                label="Responsável"
                error={errors.guardian_name?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("guardian_name")}
                  name="guardian_name"
                  placeholder="Quem acompanha o paciente"
                  defaultValue={patient?.guardian_name ?? ""}
                  aria-invalid={Boolean(errors.guardian_name)}
                  aria-describedby={errorId("guardian_name")}
                />
              </FormField>

              <FormField
                htmlFor={id("guardian_relationship")}
                label="Parentesco"
                error={errors.guardian_relationship?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("guardian_relationship")}
                  name="guardian_relationship"
                  placeholder="Ex.: Mãe, filho, cônjuge"
                  defaultValue={patient?.guardian_relationship ?? ""}
                  aria-invalid={Boolean(errors.guardian_relationship)}
                  aria-describedby={errorId("guardian_relationship")}
                />
              </FormField>

              <FormField
                htmlFor={id("guardian_phone")}
                label="Telefone do responsável"
                error={errors.guardian_phone?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("guardian_phone")}
                  name="guardian_phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="(00) 00000-0000"
                  defaultValue={patient?.guardian_phone ?? ""}
                  aria-invalid={Boolean(errors.guardian_phone)}
                  aria-describedby={errorId("guardian_phone")}
                />
              </FormField>

              <FormField
                htmlFor={id("guardian_cpf")}
                label="CPF do responsável"
                error={errors.guardian_cpf?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("guardian_cpf")}
                  name="guardian_cpf"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  defaultValue={patient?.guardian_cpf ? formatCpf(patient.guardian_cpf) : ""}
                  aria-invalid={Boolean(errors.guardian_cpf)}
                  aria-describedby={errorId("guardian_cpf")}
                />
              </FormField>
            </FieldGrid>
          </FormSection>

          <FormSection
            icon={<ShieldCheckIcon />}
            title="Convênio"
            description="Sem carteirinha e validade, a guia volta como glosa."
          >
            <FieldGrid>
              <FormField
                htmlFor={id("insurance_name")}
                label="Convênio"
                error={errors.insurance_name?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("insurance_name")}
                  name="insurance_name"
                  placeholder="Ex.: Unimed"
                  defaultValue={patient?.insurance_name ?? ""}
                  aria-invalid={Boolean(errors.insurance_name)}
                  aria-describedby={errorId("insurance_name")}
                />
              </FormField>

              <FormField
                htmlFor={id("insurance_plan")}
                label="Plano"
                error={errors.insurance_plan?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("insurance_plan")}
                  name="insurance_plan"
                  placeholder="Ex.: Nacional Enfermaria"
                  defaultValue={patient?.insurance_plan ?? ""}
                  aria-invalid={Boolean(errors.insurance_plan)}
                  aria-describedby={errorId("insurance_plan")}
                />
              </FormField>

              <FormField
                htmlFor={id("insurance_number")}
                label="Carteirinha"
                error={errors.insurance_number?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("insurance_number")}
                  name="insurance_number"
                  inputMode="numeric"
                  placeholder="Número impresso no cartão"
                  defaultValue={patient?.insurance_number ?? ""}
                  aria-invalid={Boolean(errors.insurance_number)}
                  aria-describedby={errorId("insurance_number")}
                />
              </FormField>

              <FormField
                htmlFor={id("insurance_valid_until")}
                label="Validade"
                error={errors.insurance_valid_until?.[0]}
                className="sm:col-span-3"
              >
                <Input
                  id={id("insurance_valid_until")}
                  name="insurance_valid_until"
                  type="date"
                  defaultValue={patient?.insurance_valid_until ?? ""}
                  aria-invalid={Boolean(errors.insurance_valid_until)}
                  aria-describedby={errorId("insurance_valid_until")}
                />
              </FormField>
            </FieldGrid>
          </FormSection>

          <FormSection
            icon={<HeartPulseIcon />}
            title="Saúde"
            description="O que a equipe precisa saber antes de atender."
          >
            <FieldGrid>
              <FormField
                htmlFor={id("blood_type")}
                label="Tipo sanguíneo"
                error={errors.blood_type?.[0]}
                className="sm:col-span-2"
              >
                <FormSelect
                  id={id("blood_type")}
                  name="blood_type"
                  defaultValue={patient?.blood_type ?? ""}
                  emptyLabel="Selecione"
                  aria-invalid={Boolean(errors.blood_type)}
                  aria-describedby={errorId("blood_type")}
                  options={BLOOD_TYPES.map((value) => ({ value, label: value }))}
                />
              </FormField>

              <FormField
                htmlFor={id("allergies")}
                label="Alergias"
                error={errors.allergies?.[0]}
                className="sm:col-span-6"
              >
                <Textarea
                  id={id("allergies")}
                  name="allergies"
                  placeholder="Medicamentos, alimentos, látex, contraste..."
                  className="min-h-20 resize-y"
                  defaultValue={patient?.allergies ?? ""}
                  aria-invalid={Boolean(errors.allergies)}
                  aria-describedby={errorId("allergies")}
                />
              </FormField>

              <FormField
                htmlFor={id("chronic_conditions")}
                label="Condições crônicas"
                error={errors.chronic_conditions?.[0]}
                className="sm:col-span-6"
              >
                <Textarea
                  id={id("chronic_conditions")}
                  name="chronic_conditions"
                  placeholder="Hipertensão, diabetes, asma..."
                  className="min-h-20 resize-y"
                  defaultValue={patient?.chronic_conditions ?? ""}
                  aria-invalid={Boolean(errors.chronic_conditions)}
                  aria-describedby={errorId("chronic_conditions")}
                />
              </FormField>

              <FormField
                htmlFor={id("medications")}
                label="Medicações em uso"
                error={errors.medications?.[0]}
                className="sm:col-span-6"
              >
                <Textarea
                  id={id("medications")}
                  name="medications"
                  placeholder="Nome, dose e frequência."
                  className="min-h-20 resize-y"
                  defaultValue={patient?.medications ?? ""}
                  aria-invalid={Boolean(errors.medications)}
                  aria-describedby={errorId("medications")}
                />
              </FormField>

              <FormField
                htmlFor={id("notes")}
                label="Observações"
                error={errors.notes?.[0]}
                className="sm:col-span-6"
              >
                <Textarea
                  id={id("notes")}
                  name="notes"
                  placeholder="Preferências, restrições e o que a equipe precisa lembrar."
                  className="min-h-24 resize-y"
                  defaultValue={patient?.notes ?? ""}
                  aria-invalid={Boolean(errors.notes)}
                  aria-describedby={errorId("notes")}
                />
              </FormField>
            </FieldGrid>
          </FormSection>
        </div>
      </ModalShell>
    </Dialog>
  );
}

/**
 * Bloco do cadastro: rótulo à esquerda no desktop, campos à direita.
 * Espelha o `EditGroup` do painel de lead — é a mesma leitura de formulário
 * longo, e um segundo desenho para o mesmo papel seria dialeto sem motivo.
 */
function FormSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-5 border-b border-border/70 py-6 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 lg:py-7">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4"
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Grade de 6 colunas: os campos declaram a própria largura por `col-span`. */
function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 gap-4 sm:grid-cols-6">{children}</div>;
}

function FormField({
  htmlFor,
  label,
  error,
  required,
  className,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="justify-between gap-3 text-xs">
        <span>
          {label}
          {required ? <span className="text-primary"> *</span> : null}
        </span>
        {error ? (
          <span id={`${htmlFor}-error`} className="font-normal text-destructive" role="alert">
            {error}
          </span>
        ) : null}
      </Label>
      {/* Alvo de toque de 44px no celular; no desktop volta à densidade do app. */}
      <div
        className={cn(
          "min-w-0 [&_[data-slot=input]]:h-11 sm:[&_[data-slot=input]]:h-10",
          error && "[&_[data-slot=input]]:border-destructive [&_[data-slot=textarea]]:border-destructive"
        )}
      >
        {children}
      </div>
    </div>
  );
}
