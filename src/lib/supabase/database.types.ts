
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "api_tokens": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expires_at": string | null,"id": string,"last_used_at": string | null,"name": string,"rate_limit_per_min": number,"revoked_at": string | null,"scopes": (string)[],"token_hash": string,"token_prefix": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"last_used_at"?: string | null,"name": string,"rate_limit_per_min"?: number,"revoked_at"?: string | null,"scopes"?: (string)[],"token_hash": string,"token_prefix": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"id"?: string,"last_used_at"?: string | null,"name"?: string,"rate_limit_per_min"?: number,"revoked_at"?: string | null,"scopes"?: (string)[],"token_hash"?: string,"token_prefix"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_tokens_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"app_environment_variables": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"secret_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"secret_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"secret_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"app_settings": {
                  Row: {
                    "key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  Insert: {
                    "key": string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"app_users": {
                  Row: {
                    "apelido_atendimento": string | null,"assinar_mensagens": boolean,"avatar_color": string,"avatar_url": string | null,"created_at": string,"email": string,"id": string,"is_active": boolean,"must_change_password": boolean,"name": string,"password_hash": string,"role": string,"updated_at": string
                  }
                  Insert: {
                    "apelido_atendimento"?: string | null,"assinar_mensagens"?: boolean,"avatar_color"?: string,"avatar_url"?: string | null,"created_at"?: string,"email": string,"id"?: string,"is_active"?: boolean,"must_change_password"?: boolean,"name": string,"password_hash": string,"role"?: string,"updated_at"?: string
                  }
                  Update: {
                    "apelido_atendimento"?: string | null,"assinar_mensagens"?: boolean,"avatar_color"?: string,"avatar_url"?: string | null,"created_at"?: string,"email"?: string,"id"?: string,"is_active"?: boolean,"must_change_password"?: boolean,"name"?: string,"password_hash"?: string,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"chat_conversations": {
                  Row: {
                    "archived_at": string | null,"contact_avatar_url": string | null,"contact_id": string,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"external_id": string,"id": string,"integration_id": string | null,"last_message_at": string | null,"last_message_preview": string | null,"metadata": NonNullable<Json>,"pinned_at": string | null,"removed_at": string | null,"status": string,"unread_count": number,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"contact_avatar_url"?: string | null,"contact_id": string,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"integration_id"?: string | null,"last_message_at"?: string | null,"last_message_preview"?: string | null,"metadata"?: NonNullable<Json>,"pinned_at"?: string | null,"removed_at"?: string | null,"status"?: string,"unread_count"?: number,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"contact_avatar_url"?: string | null,"contact_id"?: string,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"integration_id"?: string | null,"last_message_at"?: string | null,"last_message_preview"?: string | null,"metadata"?: NonNullable<Json>,"pinned_at"?: string | null,"removed_at"?: string | null,"status"?: string,"unread_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_conversations_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_conversations_integration_id_fkey"
      columns: ["integration_id"]
isOneToOne: false
      referencedRelation: "chat_integrations"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_integrations": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"is_active": boolean,"name": string,"phone_number": string | null,"provider": string,"token_secret_id": string | null,"updated_at": string,"webhook_secret_id": string | null
                  }
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"phone_number"?: string | null,"provider": string,"token_secret_id"?: string | null,"updated_at"?: string,"webhook_secret_id"?: string | null
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"phone_number"?: string | null,"provider"?: string,"token_secret_id"?: string | null,"updated_at"?: string,"webhook_secret_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"chat_messages": {
                  Row: {
                    "content": string | null,"conversation_id": string,"created_at": string,"delivery_status": string,"direction": string,"external_id": string | null,"id": string,"is_deleted": boolean,"media_bucket": string | null,"media_key": string | null,"media_mime_type": string | null,"media_url": string | null,"metadata": NonNullable<Json>,"quoted_message_id": string | null,"sender_type": string,"sent_by_user_id": string | null,"type": string
                  }
                  Insert: {
                    "content"?: string | null,"conversation_id": string,"created_at"?: string,"delivery_status"?: string,"direction": string,"external_id"?: string | null,"id"?: string,"is_deleted"?: boolean,"media_bucket"?: string | null,"media_key"?: string | null,"media_mime_type"?: string | null,"media_url"?: string | null,"metadata"?: NonNullable<Json>,"quoted_message_id"?: string | null,"sender_type": string,"sent_by_user_id"?: string | null,"type"?: string
                  }
                  Update: {
                    "content"?: string | null,"conversation_id"?: string,"created_at"?: string,"delivery_status"?: string,"direction"?: string,"external_id"?: string | null,"id"?: string,"is_deleted"?: boolean,"media_bucket"?: string | null,"media_key"?: string | null,"media_mime_type"?: string | null,"media_url"?: string | null,"metadata"?: NonNullable<Json>,"quoted_message_id"?: string | null,"sender_type"?: string,"sent_by_user_id"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_quoted_message_id_fkey"
      columns: ["quoted_message_id"]
isOneToOne: false
      referencedRelation: "chat_messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chat_messages_sent_by_user_id_fkey"
      columns: ["sent_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"chat_quick_replies": {
                  Row: {
                    "content": string,"created_at": string,"created_by_user_id": string | null,"id": string,"is_active": boolean,"shortcut": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "content": string,"created_at"?: string,"created_by_user_id"?: string | null,"id"?: string,"is_active"?: boolean,"shortcut": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "content"?: string,"created_at"?: string,"created_by_user_id"?: string | null,"id"?: string,"is_active"?: boolean,"shortcut"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_quick_replies_created_by_user_id_fkey"
      columns: ["created_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_events": {
                  Row: {
                    "contact_id": string,"created_at": string,"entity_id": string | null,"entity_type": string | null,"event_key": string | null,"event_type": string,"id": string,"metadata": NonNullable<Json>,"occurred_at": string
                  }
                  Insert: {
                    "contact_id": string,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"event_key"?: string | null,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string | null,"event_key"?: string | null,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_events_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_phone_identities": {
                  Row: {
                    "contact_id": string,"created_at": string,"id": string,"is_primary": boolean,"match_key": string,"normalized_phone": string,"source": string,"updated_at": string
                  }
                  Insert: {
                    "contact_id": string,"created_at"?: string,"id"?: string,"is_primary"?: boolean,"match_key": string,"normalized_phone": string,"source"?: string,"updated_at"?: string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"id"?: string,"is_primary"?: boolean,"match_key"?: string,"normalized_phone"?: string,"source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_phone_identities_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_tags": {
                  Row: {
                    "contact_id": string,"created_at": string,"tag_id": string
                  }
                  Insert: {
                    "contact_id": string,"created_at"?: string,"tag_id": string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_tags_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contact_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "anonymized_at": string | null,"archived_at": string | null,"avatar_bucket": string | null,"avatar_key": string | null,"created_at": string,"customer_id": string | null,"email": string | null,"id": string,"last_message_at": string | null,"name": string | null,"normalized_phone": string,"notes": string | null,"phone": string,"search_name": string | null,"source": string,"updated_at": string
                  }
                  Insert: {
                    "anonymized_at"?: string | null,"archived_at"?: string | null,"avatar_bucket"?: string | null,"avatar_key"?: string | null,"created_at"?: string,"customer_id"?: string | null,"email"?: string | null,"id"?: string,"last_message_at"?: string | null,"name"?: string | null,"normalized_phone": string,"notes"?: string | null,"phone": string,"search_name"?: never,"source"?: string,"updated_at"?: string
                  }
                  Update: {
                    "anonymized_at"?: string | null,"archived_at"?: string | null,"avatar_bucket"?: string | null,"avatar_key"?: string | null,"created_at"?: string,"customer_id"?: string | null,"email"?: string | null,"id"?: string,"last_message_at"?: string | null,"name"?: string | null,"normalized_phone"?: string,"notes"?: string | null,"phone"?: string,"search_name"?: never,"source"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"conversation_tags": {
                  Row: {
                    "conversation_id": string,"created_at": string,"tag_id": string
                  }
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"tag_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"tag_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_tags_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_tags_tag_id_fkey"
      columns: ["tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_logs": {
                  Row: {
                    "action": string | null,"api_token_id": string | null,"created_at": string,"direction": string | null,"error": string | null,"http_status": number | null,"id": string,"latency_ms": number | null,"payload": Json | null,"provider": string,"request_id": string | null,"route": string | null,"status": string | null
                  }
                  Insert: {
                    "action"?: string | null,"api_token_id"?: string | null,"created_at"?: string,"direction"?: string | null,"error"?: string | null,"http_status"?: number | null,"id"?: string,"latency_ms"?: number | null,"payload"?: Json | null,"provider": string,"request_id"?: string | null,"route"?: string | null,"status"?: string | null
                  }
                  Update: {
                    "action"?: string | null,"api_token_id"?: string | null,"created_at"?: string,"direction"?: string | null,"error"?: string | null,"http_status"?: number | null,"id"?: string,"latency_ms"?: number | null,"payload"?: Json | null,"provider"?: string,"request_id"?: string | null,"route"?: string | null,"status"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_logs_api_token_id_fkey"
      columns: ["api_token_id"]
isOneToOne: false
      referencedRelation: "api_tokens"
      referencedColumns: ["id"]
    }
                  ]
                },"tags": {
                  Row: {
                    "color": string,"created_at": string,"id": string,"name": string
                  }
                  Insert: {
                    "color"?: string,"created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_notes": {
                  Row: {
                    "color": string,"content": string,"created_at": string,"id": string,"kind": string,"position": number,"title": string | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "color"?: string,"content"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"position"?: number,"title"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "color"?: string,"content"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"position"?: number,"title"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_notes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "assert_security_baseline":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"clear_chat_conversation":
{ Args: { "p_conversation_id": string }; Returns: Json
                           },
"create_app_user":
{ Args: { "p_apelido_atendimento"?: string,"p_assinar_mensagens"?: boolean,"p_avatar_color": string,"p_email": string,"p_must_change_password"?: boolean,"p_name": string,"p_password": string,"p_role": string }; Returns: {
              "avatar_color": string,"avatar_url": string,"created_at": string,"email": string,"id": string,"is_active": boolean,"name": string,"role": string
            }[]
                           },
"delete_app_environment_variable":
{ Args: { "p_name": string }; Returns: boolean
                           },
"delete_app_user":
{ Args: { "p_actor_id": string,"p_id": string }; Returns: undefined
                           },
"get_app_environment_variable":
{ Args: { "p_name": string }; Returns: string
                           },
"get_app_environment_variables":
{ Args: { "p_names": (string)[] }; Returns: {
              "name": string,"value": string
            }[]
                           },
"get_chat_integration_secret":
{ Args: { "p_integration_id": string,"p_kind": string }; Returns: string
                           },
"normalize_phone":
{ Args: { "p_phone": string }; Returns: string
                           },
"normalize_search_text":
{ Args: { "p_value": string }; Returns: string
                           },
"phone_match_key":
{ Args: { "p_phone": string }; Returns: string
                           },
"reset_app_user_password":
{ Args: { "p_actor_id": string,"p_id": string,"p_must_change_password"?: boolean,"p_password": string }; Returns: undefined
                           },
"resolve_contact_identity":
{ Args: { "p_last_interaction_at"?: string,"p_name"?: string,"p_phone": string,"p_reactivate"?: boolean,"p_source"?: string }; Returns: Json
                           },
"set_app_environment_variable":
{ Args: { "p_name": string,"p_replace"?: boolean,"p_value": string }; Returns: boolean
                           },
"set_chat_integration_secret":
{ Args: { "p_integration_id": string,"p_kind": string,"p_value": string }; Returns: boolean
                           },
"update_app_user":
{ Args: { "p_actor_id": string,"p_apelido_atendimento"?: string,"p_assinar_mensagens"?: boolean,"p_avatar_color": string,"p_avatar_url": string,"p_email": string,"p_id": string,"p_is_active": boolean,"p_name": string,"p_role": string }; Returns: {
              "avatar_color": string,"avatar_url": string,"created_at": string,"email": string,"id": string,"is_active": boolean,"name": string,"role": string
            }[]
                           },
"verify_login":
{ Args: { "p_email": string,"p_password": string }; Returns: {
              "avatar_color": string,"avatar_url": string,"email": string,"id": string,"name": string,"role": string
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

