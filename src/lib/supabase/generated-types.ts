export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          class_name: string | null
          created_at: string
          id: string
          lead_id: string | null
          modality: string | null
          payload: Json
          scheduled_at: string
          source: string
          status: string
          teacher_name: string | null
          updated_at: string
        }
        Insert: {
          class_name?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          modality?: string | null
          payload?: Json
          scheduled_at: string
          source?: string
          status?: string
          teacher_name?: string | null
          updated_at?: string
        }
        Update: {
          class_name?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          modality?: string | null
          payload?: Json
          scheduled_at?: string
          source?: string
          status?: string
          teacher_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          ai_service: string | null
          created_at: string | null
          email: string | null
          id: number
          memoria_contexto: string | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          ai_service?: string | null
          created_at?: string | null
          email?: string | null
          id?: number
          memoria_contexto?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_service?: string | null
          created_at?: string | null
          email?: string | null
          id?: number
          memoria_contexto?: string | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      followups: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          message: string | null
          payload: Json
          reason: string | null
          recovered: boolean
          replied: boolean
          replied_at: string | null
          sent_at: string
          step: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          message?: string | null
          payload?: Json
          reason?: string | null
          recovered?: boolean
          replied?: boolean
          replied_at?: string | null
          sent_at?: string
          step: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          message?: string | null
          payload?: Json
          reason?: string | null
          recovered?: boolean
          replied?: boolean
          replied_at?: string | null
          sent_at?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          action: string
          created_at: string
          direction: string
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: string
          provider: string
          request_payload: Json | null
          response_payload: Json | null
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          direction: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          provider: string
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
        }
        Update: {
          action?: string
          created_at?: string
          direction?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          provider?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          channel: string | null
          created_at: string
          direction: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          lead_id: string | null
          message: string | null
          occurred_at: string
          payload: Json
        }
        Insert: {
          channel?: string | null
          created_at?: string
          direction?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          message?: string | null
          occurred_at?: string
          payload?: Json
        }
        Update: {
          channel?: string | null
          created_at?: string
          direction?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          message?: string | null
          occurred_at?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          age: number | null
          attended_at: string | null
          converted_at: string | null
          created_at: string
          first_message_at: string | null
          id: string
          instagram_user: string | null
          last_message_at: string | null
          lost_at: string | null
          modality: string | null
          name: string | null
          normalized_phone: string
          notes: string | null
          objective: string | null
          phone: string
          qualified_at: string | null
          scheduled_at: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          age?: number | null
          attended_at?: string | null
          converted_at?: string | null
          created_at?: string
          first_message_at?: string | null
          id?: string
          instagram_user?: string | null
          last_message_at?: string | null
          lost_at?: string | null
          modality?: string | null
          name?: string | null
          normalized_phone: string
          notes?: string | null
          objective?: string | null
          phone: string
          qualified_at?: string | null
          scheduled_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          age?: number | null
          attended_at?: string | null
          converted_at?: string | null
          created_at?: string
          first_message_at?: string | null
          id?: string
          instagram_user?: string | null
          last_message_at?: string | null
          lost_at?: string | null
          modality?: string | null
          name?: string | null
          normalized_phone?: string
          notes?: string | null
          objective?: string | null
          phone?: string
          qualified_at?: string | null
          scheduled_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      n8n_chat_histories: {
        Row: {
          id: number
          message: Json
          session_id: string
        }
        Insert: {
          id?: number
          message: Json
          session_id: string
        }
        Update: {
          id?: number
          message?: Json
          session_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      dashboard_followup_summary: {
        Row: {
          recovered_followups: number | null
          replied_followups: number | null
          total_followups: number | null
        }
        Relationships: []
      }
      dashboard_funnel_summary: {
        Row: {
          attended_leads: number | null
          converted_leads: number | null
          lost_leads: number | null
          qualified_leads: number | null
          scheduled_leads: number | null
          total_leads: number | null
        }
        Relationships: []
      }
      chat_integrations: {
        Row: {
          id: string
          name: string
          provider: string
          phone_number: string | null
          config: Json
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          provider: string
          phone_number?: string | null
          config?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          provider?: string
          phone_number?: string | null
          config?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          id: string
          integration_id: string | null
          external_id: string
          contact_name: string | null
          contact_phone: string | null
          contact_avatar_url: string | null
          archived_at: string | null
          status: string
          unread_count: number
          last_message_at: string | null
          last_message_preview: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          integration_id?: string | null
          external_id: string
          contact_name?: string | null
          contact_phone?: string | null
          contact_avatar_url?: string | null
          archived_at?: string | null
          status?: string
          unread_count?: number
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          integration_id?: string | null
          external_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          contact_avatar_url?: string | null
          archived_at?: string | null
          status?: string
          unread_count?: number
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "chat_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          id: string
          conversation_id: string
          external_id: string | null
          direction: string
          type: string
          content: string | null
          media_url: string | null
          media_mime_type: string | null
          quoted_message_id: string | null
          delivery_status: string
          sent_by_user_id: string | null
          is_deleted: boolean
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          external_id?: string | null
          direction: string
          type?: string
          content?: string | null
          media_url?: string | null
          media_mime_type?: string | null
          quoted_message_id?: string | null
          delivery_status?: string
          sent_by_user_id?: string | null
          is_deleted?: boolean
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          external_id?: string | null
          direction?: string
          type?: string
          content?: string | null
          media_url?: string | null
          media_mime_type?: string | null
          quoted_message_id?: string | null
          delivery_status?: string
          sent_by_user_id?: string | null
          is_deleted?: boolean
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_quick_replies: {
        Row: {
          id: string
          shortcut: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          shortcut: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          shortcut?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

