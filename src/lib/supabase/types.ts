export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Funil do CRM. As colunas do kanban
// são dinâmicas (tabela board_columns); status é string livre referenciando board_columns.key.
export type CanonicalLeadStatus =
  | "novo"
  | "em_atendimento"
  | "qualificado"
  | "agendado"
  | "compareceu"
  | "cliente"
  | "recorrente"
  | "perdido";

export type LeadStatus = string;

export type LeadSource =
  | "agencia"
  | "anuncio"
  | "particular"
  | "indicacao"
  | "whatsapp"
  | "importado"
  | "outro";

export type TipoEnsaio =
  | "crianca"
  | "gestante"
  | "casal"
  | "quinze_anos"
  | "senhora"
  | "book_agencia"
  | "sensual"
  | "profissional"
  | "outro"
  // Campo de texto livre (rótulos customizáveis por cliente); mantém os valores
  // conhecidos para autocomplete, mas aceita qualquer string.
  | (string & {});

export type AppointmentStatus =
  | "agendado"
  | "confirmado"
  | "compareceu"
  | "faltou"
  | "cancelado";

/** Como o atendimento acontece. `null` = agendamento antigo, sem a informação. */
export type AppointmentModality = "presencial" | "teleconsulta";

export type FollowupStatus = "pendente" | "enviado" | "cancelado";

export type ContractStatus = "aberto" | "quitado" | "cancelado";

export type PaymentMethod =
  | "pix"
  | "credito"
  | "debito"
  | "dinheiro"
  | "link"
  | "parcelado";

export type PaymentStatus = "pago" | "pendente" | "estornado";

export type ExpenseCategory =
  | "luz"
  | "agua"
  | "aluguel"
  | "internet"
  | "limpeza"
  | "equipamento"
  | "manutencao"
  | "fornecedor"
  | "operacional"
  | "cartao_credito"
  | "cartao_debito"
  | "marketing"
  | "software"
  | "alimentacao"
  | "combustivel"
  | "seguro"
  | "imposto"
  | "salario"
  | "outro"
  | (string & {});

export type IntegrationStatus = "ok" | "error";

export type Database = {
  public: {
    Tables: {
      api_tokens: {
        Row: {
          id: string;
          name: string;
          token_hash: string;
          token_prefix: string;
          created_by: string | null;
          created_at: string;
          last_used_at: string | null;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          token_hash: string;
          token_prefix: string;
          created_by?: string | null;
          created_at?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          token_hash?: string;
          token_prefix?: string;
          created_by?: string | null;
          created_at?: string;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      app_users: {
        Row: {
          id: string;
          email: string;
          name: string;
          password_hash: string;
          is_active: boolean;
          role: "admin" | "member" | "paid_traffic";
          avatar_url: string | null;
          avatar_color: string;
          must_change_password: boolean;
          apelido_atendimento: string | null;
          assinar_mensagens: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          name: string;
          password_hash: string;
          is_active?: boolean;
          role?: "admin" | "member" | "paid_traffic";
          avatar_url?: string | null;
          avatar_color?: string;
          must_change_password?: boolean;
          apelido_atendimento?: string | null;
          assinar_mensagens?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string;
          password_hash?: string;
          is_active?: boolean;
          role?: "admin" | "member" | "paid_traffic";
          avatar_url?: string | null;
          avatar_color?: string;
          must_change_password?: boolean;
          apelido_atendimento?: string | null;
          assinar_mensagens?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          name: string | null;
          phone: string | null;
          normalized_phone: string | null;
          instagram_user: string | null;
          email: string | null;
          // Origem / triagem
          source: LeadSource | null;
          agencia_nome: string | null;
          modelo_nome: string | null;
          // Funil
          status: LeadStatus;
          // Qualificação
          tipo_ensaio: TipoEnsaio | null;
          interesse: string | null;
          valor_estimado: number | null;
          is_recorrente: boolean | null;
          historico_compras: string | null;
          imported: boolean | null;
          // IA / notas
          memoria_contexto: string | null;
          notes: string | null;
          // Timestamps de etapa
          last_message_at: string | null;
          qualificado_at: string | null;
          agendado_at: string | null;
          compareceu_at: string | null;
          cliente_at: string | null;
          archived_at: string | null;
          /** Cadastro clínico desta pessoa, quando ela já virou paciente. */
          patient_id: string | null;
          /** Quando virou paciente (agendou ou foi promovida). */
          converted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["leads"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["leads"]["Row"]>;
        Relationships: [];
      };
      lead_phone_identities: {
        Row: {
          id: string;
          lead_id: string;
          normalized_phone: string;
          match_key: string;
          source: string;
          provider: string | null;
          is_primary: boolean;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["lead_phone_identities"]["Row"]> & {
          lead_id: string;
          normalized_phone: string;
          match_key: string;
        };
        Update: Partial<Database["public"]["Tables"]["lead_phone_identities"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "lead_phone_identities_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_events: {
        Row: {
          id: string;
          lead_id: string;
          event_type: string;
          entity_type: string | null;
          entity_id: string | null;
          event_key: string | null;
          metadata: Json;
          occurred_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["lead_events"]["Row"]> & {
          lead_id: string;
          event_type: string;
        };
        Update: Partial<Database["public"]["Tables"]["lead_events"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      deals: {
        Row: {
          id: string;
          lead_id: string;
          appointment_id: string | null;
          title: string | null;
          tipo_ensaio: TipoEnsaio | null;
          valor: number | null;
          // Etapa do funil (livre; referencia board_columns.key, igual leads.status).
          stage: LeadStatus;
          scheduled_at: string | null;
          notes: string | null;
          source: string;
          meta_attribution_id: string | null;
          idempotency_key: string | null;
          won_at: string | null;
          lost_at: string | null;
          removed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["deals"]["Row"]> & {
          lead_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["deals"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "deals_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
        ];
      };
      appointments: {
        Row: {
          id: string;
          lead_id: string | null;
          scheduled_at: string;
          duration_min: number | null;
          tipo_ensaio: string | null;
          status: AppointmentStatus;
          google_event_id: string | null;
          reminder_d3_sent: boolean;
          reminder_d0_sent: boolean;
          notes: string | null;
          idempotency_key: string | null;
          created_by_user_id: string | null;
          /** "presencial" | "teleconsulta" | null (não informado). */
          modality: AppointmentModality | null;
          unit_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["appointments"]["Row"]> & {
          scheduled_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["appointments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "appointments_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_created_by_user_id_fkey";
            columns: ["created_by_user_id"];
            isOneToOne: false;
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      followups: {
        Row: {
          id: string;
          lead_id: string | null;
          scheduled_for: string;
          status: FollowupStatus;
          message: string | null;
          created_at: string;
          sent_at: string | null;
          step: string | null;
          replied: boolean;
          replied_at: string | null;
          recovered: boolean;
          idempotency_key: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["followups"]["Row"]> & {
          scheduled_for: string;
        };
        Update: Partial<Database["public"]["Tables"]["followups"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "followups_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_logs: {
        Row: {
          id: string;
          provider: string;
          direction: "inbound" | "outbound" | null;
          action: string | null;
          status: IntegrationStatus | null;
          payload: Json | null;
          error: string | null;
          created_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["integration_logs"]["Row"]
        > & {
          provider: string;
        };
        Update: Partial<Database["public"]["Tables"]["integration_logs"]["Row"]>;
        Relationships: [];
      };
      // Catálogo de procedimentos mantido pelo usuário no combobox da venda.
      // Apagar arquiva (`archived_at`): a venda guarda o nome como texto, então
      // o histórico não depende desta tabela.
      procedures: {
        Row: {
          id: string;
          name: string;
          default_amount: number | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["procedures"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["procedures"]["Row"]>;
        Relationships: [];
      };
      appointment_types: {
        Row: {
          id: string;
          name: string;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["appointment_types"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["appointment_types"]["Row"]>;
        Relationships: [];
      };
      agenda_blocks: {
        Row: {
          id: string;
          starts_at: string;
          /** Exclusivo: um bloqueio até 14:00 libera a consulta das 14:00. */
          ends_at: string;
          all_day: boolean;
          reason: string | null;
          created_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["agenda_blocks"]["Row"]> & {
          starts_at: string;
          ends_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["agenda_blocks"]["Row"]>;
        Relationships: [];
      };
      clinic_units: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["clinic_units"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["clinic_units"]["Row"]>;
        Relationships: [];
      };
      agenda_hours: {
        Row: {
          /** 0 = domingo … 6 = sábado. */
          weekday: number;
          /** Horários sugeridos, "HH:MM", em ordem. */
          times: string[];
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["agenda_hours"]["Row"]> & {
          weekday: number;
        };
        Update: Partial<Database["public"]["Tables"]["agenda_hours"]["Row"]>;
        Relationships: [];
      };
      contracts: {
        Row: {
          id: string;
          lead_id: string | null;
          package_name: string | null;
          total_amount: number;
          signal_amount: number;
          discount: number;
          status: ContractStatus;
          notes: string | null;
          /** Retry e duplo-clique não duplicam venda. */
          idempotency_key: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contracts"]["Row"]> & {
          total_amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["contracts"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "contracts_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          lead_id: string | null;
          contract_id: string | null;
          amount: number;
          method: PaymentMethod | null;
          installments: number;
          is_signal: boolean;
          status: PaymentStatus;
          due_at: string | null;
          paid_at: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["payments"]["Row"]> & {
          amount: number;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Row"]>;
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          category: ExpenseCategory;
          kind: "fixa" | "variavel";
          description: string | null;
          amount: number;
          status: "pago" | "pendente";
          due_at: string | null;
          paid_at: string | null;
          recurring: boolean;
          vendor: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["expenses"]["Row"]> & {
          amount: number;
          category: ExpenseCategory;
        };
        Update: Partial<Database["public"]["Tables"]["expenses"]["Row"]>;
        Relationships: [];
      };
      // Cadastro clínico. ⚠️ Dado pessoal sensível (CPF, filiação, endereço,
      // saúde): selecione colunas explicitamente e nunca devolva a linha
      // inteira para o cliente.
      patients: {
        Row: {
          id: string;
          full_name: string;
          social_name: string | null;
          birth_date: string | null;
          /** 'feminino' | 'masculino' | 'intersexo' | 'nao_informado' */
          sex: string | null;
          /** Só dígitos (constraint no banco). */
          cpf: string | null;
          rg: string | null;
          marital_status: string | null;
          occupation: string | null;
          nationality: string | null;
          birthplace: string | null;
          phone: string | null;
          phone_alt: string | null;
          email: string | null;
          zip_code: string | null;
          street: string | null;
          street_number: string | null;
          complement: string | null;
          district: string | null;
          city: string | null;
          state: string | null;
          mother_name: string | null;
          father_name: string | null;
          guardian_name: string | null;
          guardian_phone: string | null;
          guardian_cpf: string | null;
          guardian_relationship: string | null;
          insurance_name: string | null;
          insurance_plan: string | null;
          insurance_number: string | null;
          insurance_valid_until: string | null;
          blood_type: string | null;
          allergies: string | null;
          chronic_conditions: string | null;
          medications: string | null;
          notes: string | null;
          archived_at: string | null;
          /** 'agendamento' | 'manual' | 'cadastro' | 'importacao' */
          promotion_source: string;
          promoted_at: string;
          created_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["patients"]["Row"]> & {
          full_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["patients"]["Row"]>;
        Relationships: [];
      };
      // Notas do usuário: o lembrete rápido (`kind: 'quick'`, um por pessoa) e
      // os post-its (`kind: 'sticky'`) da tela de Início.
      user_notes: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          title: string | null;
          content: string;
          color: string;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind?: string;
          title?: string | null;
          content?: string;
          color?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          title?: string | null;
          content?: string;
          color?: string;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value?: Json;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_environment_variables: {
        Row: {
          id: string;
          name: string;
          secret_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          secret_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          secret_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Funis. O registro `kind: 'leads'` representa o funil nativo, cujos
      // cards são `deals`; os `custom` usam `pipeline_cards`.
      pipelines: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          color: string;
          /** 'leads' | 'custom' */
          kind: string;
          is_default: boolean;
          position: number;
          archived_at: string | null;
          created_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["pipelines"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["pipelines"]["Row"]>;
        Relationships: [];
      };
      // Cards dos funis personalizados. Lead e paciente são OPCIONAIS: um card
      // pode ser de processo interno, sem pessoa nenhuma.
      pipeline_cards: {
        Row: {
          id: string;
          pipeline_id: string;
          /** `key` de uma coluna DESTE funil (validado por gatilho). */
          stage: string;
          title: string;
          description: string | null;
          lead_id: string | null;
          patient_id: string | null;
          amount: number | null;
          due_at: string | null;
          assigned_to_user_id: string | null;
          position: number;
          archived_at: string | null;
          created_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["pipeline_cards"]["Row"]> & {
          pipeline_id: string;
          stage: string;
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["pipeline_cards"]["Row"]>;
        Relationships: [];
      };
      board_columns: {
        Row: {
          id: string;
          key: string;
          label: string;
          color: string;
          position: number;
          probability: number | null;
          stage_type: string;
          // Leads nesta etapa entram na taxa de conversão do dashboard.
          // Independente de stage_type: `compareceu` é etapa aberta e pode
          // contar. Ver 20260807140000_coluna_de_conversao_no_funil.sql.
          counts_as_conversion: boolean;
          /** A etapa pertence a UM funil; a chave é única dentro dele. */
          pipeline_id: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["board_columns"]["Row"]> & {
          key: string;
          label: string;
        };
        Update: Partial<Database["public"]["Tables"]["board_columns"]["Row"]>;
        Relationships: [];
      };
      tags: {
        Row: {
          id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tags"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["tags"]["Row"]>;
        Relationships: [];
      };
      lead_tags: {
        Row: {
          lead_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          lead_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["lead_tags"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "lead_tags_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_tags: {
        Row: {
          conversation_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          conversation_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_tags"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "conversation_tags_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "chat_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      feedback_requests: {
        Row: {
          id: string;
          image_url: string | null;
          caption: string | null;
          author_name: string | null;
          status: string;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["feedback_requests"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["feedback_requests"]["Row"]>;
        Relationships: [];
      };
      chat_integrations: {
        Row: {
          id: string;
          name: string;
          provider: string;
          phone_number: string | null;
          config: Json;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          provider: string;
          phone_number?: string | null;
          config?: Json;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          provider?: string;
          phone_number?: string | null;
          config?: Json;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_conversations: {
        Row: {
          id: string;
          integration_id: string | null;
          lead_id: string;
          external_id: string;
          contact_name: string | null;
          contact_phone: string | null;
          contact_avatar_url: string | null;
          archived_at: string | null;
          removed_at: string | null;
          /** Data em que foi fixada. Ordena as fixadas entre si; `null` = solta. */
          pinned_at: string | null;
          status: string;
          unread_count: number;
          last_message_at: string | null;
          last_message_preview: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          integration_id?: string | null;
          lead_id: string;
          external_id: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          contact_avatar_url?: string | null;
          archived_at?: string | null;
          removed_at?: string | null;
          pinned_at?: string | null;
          status?: string;
          unread_count?: number;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          integration_id?: string | null;
          lead_id?: string;
          external_id?: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          contact_avatar_url?: string | null;
          archived_at?: string | null;
          removed_at?: string | null;
          pinned_at?: string | null;
          status?: string;
          unread_count?: number;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_conversations_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          conversation_id: string;
          external_id: string | null;
          direction: string;
          type: string;
          content: string | null;
          media_url: string | null;
          media_mime_type: string | null;
          quoted_message_id: string | null;
          delivery_status: string;
          sent_by_user_id: string | null;
          is_deleted: boolean;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          external_id?: string | null;
          direction: string;
          type?: string;
          content?: string | null;
          media_url?: string | null;
          media_mime_type?: string | null;
          quoted_message_id?: string | null;
          delivery_status?: string;
          sent_by_user_id?: string | null;
          is_deleted?: boolean;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          external_id?: string | null;
          direction?: string;
          type?: string;
          content?: string | null;
          media_url?: string | null;
          media_mime_type?: string | null;
          quoted_message_id?: string | null;
          delivery_status?: string;
          sent_by_user_id?: string | null;
          is_deleted?: boolean;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      chat_quick_replies: {
        Row: {
          id: string;
          title: string;
          shortcut: string;
          content: string;
          is_active: boolean;
          created_by_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          shortcut: string;
          content: string;
          is_active?: boolean;
          created_by_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          shortcut?: string;
          content?: string;
          is_active?: boolean;
          created_by_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_quick_replies_created_by_user_id_fkey";
            columns: ["created_by_user_id"];
            isOneToOne: false;
            referencedRelation: "app_users";
            referencedColumns: ["id"];
          },
        ];
      };
      meta_ad_assets: {
        Row: {
          source_id: string;
          source_type: "ad" | "post" | "unknown";
          ad_id: string | null;
          ad_name: string | null;
          adset_id: string | null;
          adset_name: string | null;
          campaign_id: string | null;
          campaign_name: string | null;
          account_id: string | null;
          enrichment_status: "pending" | "enriched" | "partial" | "retry" | "error";
          attempt_count: number;
          next_attempt_at: string;
          last_error: string | null;
          refreshed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["meta_ad_assets"]["Row"]> & {
          source_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["meta_ad_assets"]["Row"]>;
        Relationships: [];
      };
      meta_attributions: {
        Row: {
          id: string;
          lead_id: string;
          source_message_id: string;
          whatsapp_business_id: string;
          phone_number_id: string | null;
          source_id: string | null;
          source_type: "ad" | "post" | "unknown";
          ctwa_clid: string | null;
          ctwa_fingerprint: string | null;
          had_ctwa_clid: boolean;
          message_at: string;
          ad_id_snapshot: string | null;
          ad_name_snapshot: string | null;
          adset_id_snapshot: string | null;
          adset_name_snapshot: string | null;
          campaign_id_snapshot: string | null;
          campaign_name_snapshot: string | null;
          account_id_snapshot: string | null;
          enriched_at: string | null;
          redacted_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["meta_attributions"]["Row"]> & {
          lead_id: string;
          source_message_id: string;
          whatsapp_business_id: string;
          message_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["meta_attributions"]["Row"]>;
        Relationships: [];
      };
      deal_stage_history: {
        Row: {
          id: string;
          deal_id: string;
          lead_id: string;
          from_stage: string | null;
          to_stage: string;
          occurred_at: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["deal_stage_history"]["Row"]> & {
          deal_id: string;
          lead_id: string;
          to_stage: string;
        };
        Update: Partial<Database["public"]["Tables"]["deal_stage_history"]["Row"]>;
        Relationships: [];
      };
      meta_conversion_outbox: {
        Row: {
          id: string;
          event_key: string;
          event_id: string;
          event_name: "LeadSubmitted" | "QualifiedLead";
          attribution_id: string | null;
          lead_id: string;
          deal_id: string | null;
          event_time: string;
          status: "pending" | "processing" | "retry" | "sent" | "dead_letter" | "skipped";
          attempt_count: number;
          next_attempt_at: string;
          lease_token: string | null;
          lease_owner: string | null;
          lease_expires_at: string | null;
          last_http_status: number | null;
          last_error_category: string | null;
          last_error_code: string | null;
          last_error_message: string | null;
          response_summary: Json | null;
          sent_at: string | null;
          requeued_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["meta_conversion_outbox"]["Row"]> & {
          event_key: string;
          event_id: string;
          event_name: "LeadSubmitted" | "QualifiedLead";
          lead_id: string;
          event_time: string;
        };
        Update: Partial<Database["public"]["Tables"]["meta_conversion_outbox"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // Lead vira paciente. Idempotente: lead já promovido devolve o mesmo id.
      // O gatilho de agendamento chama a mesma função, com p_source='agendamento'.
      promote_lead_to_patient: {
        Args: {
          p_lead_id: string;
          p_source?: string;
          p_user_id?: string | null;
        };
        Returns: string | null;
      };
      // Venda em uma transação só: contrato + pagamentos + etapa do funil.
      // Os valores chegam já calculados de features/financeiro/lib.
      register_sale: {
        Args: {
          p_idempotency_key: string;
          p_lead_id: string;
          p_deal_id: string | null;
          p_procedure_name: string;
          p_total_amount: number;
          p_discount: number;
          p_notes: string | null;
          p_payments: unknown;
          p_stage_key: string | null;
          p_stamp_cliente_at: boolean;
        };
        Returns: {
          contractId: string;
          status: ContractStatus;
          moved: boolean;
          alreadyRegistered: boolean;
        };
      };
      // Edição da venda: pagamentos derivam dos valores, então o conjunto é
      // substituído inteiro numa transação.
      update_sale: {
        Args: {
          p_contract_id: string;
          p_procedure_name: string;
          p_total_amount: number;
          p_discount: number;
          p_notes: string | null;
          p_payments: unknown;
        };
        Returns: { contractId: string; leadId: string | null };
      };
      verify_login: {
        Args: { p_email: string; p_password: string };
        Returns: {
          id: string;
          email: string;
          name: string;
          role: "admin" | "member" | "paid_traffic";
          avatar_url: string | null;
          avatar_color: string;
        }[];
      };
      create_app_user: {
        Args: {
          p_email: string;
          p_name: string;
          p_password: string;
          p_role: "admin" | "member" | "paid_traffic";
          p_avatar_color: string;
          p_must_change_password?: boolean;
          p_apelido_atendimento?: string | null;
          p_assinar_mensagens?: boolean;
        };
        Returns: {
          id: string;
          email: string;
          name: string;
          role: "admin" | "member" | "paid_traffic";
          avatar_url: string | null;
          avatar_color: string;
          is_active: boolean;
          created_at: string;
        }[];
      };
      update_app_user: {
        Args: {
          p_actor_id: string;
          p_id: string;
          p_name: string;
          p_email: string;
          p_is_active: boolean;
          p_role: "admin" | "member" | "paid_traffic";
          p_avatar_url: string | null;
          p_avatar_color: string;
          p_apelido_atendimento?: string | null;
          p_assinar_mensagens?: boolean | null;
        };
        Returns: {
          id: string;
          email: string;
          name: string;
          role: "admin" | "member" | "paid_traffic";
          avatar_url: string | null;
          avatar_color: string;
          is_active: boolean;
          created_at: string;
        }[];
      };
      reset_app_user_password: {
        Args: {
          p_actor_id: string;
          p_id: string;
          p_password: string;
          p_must_change_password?: boolean | null;
        };
        Returns: undefined;
      };
      delete_app_user: {
        Args: { p_actor_id: string; p_id: string };
        Returns: undefined;
      };
      increment_unread: {
        Args: { conv_id: string };
        Returns: undefined;
      };
      resolve_lead_identity: {
        Args: {
          p_phone: string;
          p_name?: string | null;
          p_source?: string;
          p_create_initial_deal?: boolean;
          p_last_interaction_at?: string | null;
          p_reactivate?: boolean;
        };
        Returns: Json;
      };
      set_lead_status_from_single_deal: {
        Args: {
          p_lead_id: string;
          p_status: string;
          p_occurred_at?: string;
          p_lead_patch?: Json;
        };
        Returns: Json;
      };
      project_lead_status_from_deals: {
        Args: {
          p_lead_id: string;
          p_occurred_at?: string | null;
        };
        Returns: string | null;
      };
      clear_chat_conversation: {
        Args: {
          p_conversation_id: string;
        };
        Returns: Json;
      };
      set_app_environment_variable: {
        Args: {
          p_name: string;
          p_value: string;
          p_replace?: boolean;
        };
        Returns: boolean;
      };
      get_app_environment_variable: {
        Args: {
          p_name: string;
        };
        Returns: string | null;
      };
      delete_app_environment_variable: {
        Args: {
          p_name: string;
        };
        Returns: boolean;
      };
      ingest_meta_webhook_message: {
        Args: {
          p_integration_id: string | null;
          p_phone: string;
          p_normalized_phone: string;
          p_contact_name: string | null;
          p_external_id: string;
          p_message_type: string;
          p_content: string | null;
          p_media_url: string | null;
          p_media_mime_type: string | null;
          p_message_at: string;
          p_whatsapp_business_id: string;
          p_phone_number_id: string | null;
          p_source_id: string | null;
          p_source_type: string | null;
          p_ctwa_clid: string | null;
        };
        Returns: Json;
      };
      claim_meta_conversion_outbox: {
        Args: { p_owner: string; p_limit?: number };
        Returns: {
          id: string;
          event_id: string;
          event_name: "LeadSubmitted" | "QualifiedLead";
          event_time: string;
          attempt_count: number;
          created_at: string;
          lease_token: string;
          ctwa_clid: string;
          whatsapp_business_id: string;
        }[];
      };
      finish_meta_conversion_outbox_item: {
        Args: {
          p_id: string;
          p_lease_token: string;
          p_status: "sent" | "retry" | "dead_letter";
          p_next_attempt_at: string | null;
          p_http_status: number | null;
          p_error_category: string | null;
          p_error_code: string | null;
          p_error_message: string | null;
          p_response_summary: Json | null;
        };
        Returns: boolean;
      };
      redact_expired_meta_attributions: {
        Args: Record<string, never>;
        Returns: number;
      };
      apply_meta_ad_asset_enrichment: {
        Args: {
          p_source_id: string;
          p_ad_id: string | null;
          p_ad_name: string | null;
          p_adset_id: string | null;
          p_adset_name: string | null;
          p_campaign_id: string | null;
          p_campaign_name: string | null;
          p_account_id: string | null;
          p_status: "enriched" | "partial" | "retry" | "error";
          p_last_error: string | null;
        };
        Returns: number;
      };
      retry_meta_conversion_outbox: {
        Args: { p_id: string };
        Returns: "requeued" | "not_found" | "conflict" | "ineligible";
      };
    };
  };
};
