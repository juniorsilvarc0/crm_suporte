
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
                    "active_ticket_id": string | null,"archived_at": string | null,"contact_avatar_url": string | null,"contact_id": string,"contact_name": string | null,"contact_phone": string | null,"created_at": string,"external_id": string,"id": string,"integration_id": string | null,"last_message_at": string | null,"last_message_preview": string | null,"metadata": NonNullable<Json>,"pinned_at": string | null,"removed_at": string | null,"status": string,"unread_count": number,"updated_at": string
                  }
                  Insert: {
                    "active_ticket_id"?: string | null,"archived_at"?: string | null,"contact_avatar_url"?: string | null,"contact_id": string,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"integration_id"?: string | null,"last_message_at"?: string | null,"last_message_preview"?: string | null,"metadata"?: NonNullable<Json>,"pinned_at"?: string | null,"removed_at"?: string | null,"status"?: string,"unread_count"?: number,"updated_at"?: string
                  }
                  Update: {
                    "active_ticket_id"?: string | null,"archived_at"?: string | null,"contact_avatar_url"?: string | null,"contact_id"?: string,"contact_name"?: string | null,"contact_phone"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"integration_id"?: string | null,"last_message_at"?: string | null,"last_message_preview"?: string | null,"metadata"?: NonNullable<Json>,"pinned_at"?: string | null,"removed_at"?: string | null,"status"?: string,"unread_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chat_conversations_active_ticket_fkey"
      columns: ["active_ticket_id","id"]
isOneToOne: false
      referencedRelation: "ticket_queue"
      referencedColumns: ["id","conversation_id"]
    },{
      foreignKeyName: "chat_conversations_active_ticket_fkey"
      columns: ["active_ticket_id","id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id","conversation_id"]
    },{
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
                    "content": string | null,"conversation_id": string,"created_at": string,"delivery_status": string,"direction": string,"external_id": string | null,"id": string,"is_deleted": boolean,"media_bucket": string | null,"media_key": string | null,"media_mime_type": string | null,"media_url": string | null,"metadata": NonNullable<Json>,"quoted_message_id": string | null,"sender_type": string,"sent_by_user_id": string | null,"ticket_id": string | null,"type": string
                  }
                  Insert: {
                    "content"?: string | null,"conversation_id": string,"created_at"?: string,"delivery_status"?: string,"direction": string,"external_id"?: string | null,"id"?: string,"is_deleted"?: boolean,"media_bucket"?: string | null,"media_key"?: string | null,"media_mime_type"?: string | null,"media_url"?: string | null,"metadata"?: NonNullable<Json>,"quoted_message_id"?: string | null,"sender_type": string,"sent_by_user_id"?: string | null,"ticket_id"?: string | null,"type"?: string
                  }
                  Update: {
                    "content"?: string | null,"conversation_id"?: string,"created_at"?: string,"delivery_status"?: string,"direction"?: string,"external_id"?: string | null,"id"?: string,"is_deleted"?: boolean,"media_bucket"?: string | null,"media_key"?: string | null,"media_mime_type"?: string | null,"media_url"?: string | null,"metadata"?: NonNullable<Json>,"quoted_message_id"?: string | null,"sender_type"?: string,"sent_by_user_id"?: string | null,"ticket_id"?: string | null,"type"?: string
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
    },{
      foreignKeyName: "chat_messages_ticket_fkey"
      columns: ["ticket_id","conversation_id"]
isOneToOne: false
      referencedRelation: "ticket_queue"
      referencedColumns: ["id","conversation_id"]
    },{
      foreignKeyName: "chat_messages_ticket_fkey"
      columns: ["ticket_id","conversation_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id","conversation_id"]
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
                    {
      foreignKeyName: "contacts_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
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
                },"customers": {
                  Row: {
                    "archived_at": string | null,"cnpj": string | null,"contract_status": string | null,"created_at": string,"created_by_user_id": string | null,"id": string,"legal_name": string,"notes": string | null,"search_name": string | null,"trade_name": string | null,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"cnpj"?: string | null,"contract_status"?: string | null,"created_at"?: string,"created_by_user_id"?: string | null,"id"?: string,"legal_name": string,"notes"?: string | null,"search_name"?: never,"trade_name"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"cnpj"?: string | null,"contract_status"?: string | null,"created_at"?: string,"created_by_user_id"?: string | null,"id"?: string,"legal_name"?: string,"notes"?: string | null,"search_name"?: never,"trade_name"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_created_by_user_id_fkey"
      columns: ["created_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
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
                },"products": {
                  Row: {
                    "archived_at": string | null,"color": string,"created_at": string,"id": string,"name": string,"niche": string | null,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"color"?: string,"created_at"?: string,"id"?: string,"name": string,"niche"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"color"?: string,"created_at"?: string,"id"?: string,"name"?: string,"niche"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sla_policies": {
                  Row: {
                    "first_response_minutes": number,"priority": string,"rank": number,"resolution_minutes": number,"updated_at": string,"warn_pct": number
                  }
                  Insert: {
                    "first_response_minutes": number,"priority": string,"rank": number,"resolution_minutes": number,"updated_at"?: string,"warn_pct"?: number
                  }
                  Update: {
                    "first_response_minutes"?: number,"priority"?: string,"rank"?: number,"resolution_minutes"?: number,"updated_at"?: string,"warn_pct"?: number
                  }
                  Relationships: [
                    
                  ]
                },"support_contract_products": {
                  Row: {
                    "contract_id": string,"created_at": string,"product_id": string
                  }
                  Insert: {
                    "contract_id": string,"created_at"?: string,"product_id": string
                  }
                  Update: {
                    "contract_id"?: string,"created_at"?: string,"product_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_contract_products_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "support_contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "support_contract_products_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"support_contracts": {
                  Row: {
                    "billing_day": number,"created_at": string,"created_by_user_id": string | null,"customer_id": string,"ends_on": string | null,"id": string,"monthly_amount": number,"plan_id": string | null,"starts_on": string,"status": string,"updated_at": string
                  }
                  Insert: {
                    "billing_day": number,"created_at"?: string,"created_by_user_id"?: string | null,"customer_id": string,"ends_on"?: string | null,"id"?: string,"monthly_amount": number,"plan_id"?: string | null,"starts_on": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "billing_day"?: number,"created_at"?: string,"created_by_user_id"?: string | null,"customer_id"?: string,"ends_on"?: string | null,"id"?: string,"monthly_amount"?: number,"plan_id"?: string | null,"starts_on"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "support_contracts_created_by_user_id_fkey"
      columns: ["created_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "support_contracts_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "support_contracts_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "support_plans"
      referencedColumns: ["id"]
    }
                  ]
                },"support_plans": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"description": string | null,"id": string,"name": string,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
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
                },"ticket_attachments": {
                  Row: {
                    "bucket": string,"created_at": string,"file_name": string,"id": string,"mime": string,"object_key": string,"sha256": string,"size_bytes": number,"ticket_id": string,"uploaded_by_token_id": string | null,"uploaded_by_user_id": string | null
                  }
                  Insert: {
                    "bucket"?: string,"created_at"?: string,"file_name": string,"id"?: string,"mime": string,"object_key": string,"sha256": string,"size_bytes": number,"ticket_id": string,"uploaded_by_token_id"?: string | null,"uploaded_by_user_id"?: string | null
                  }
                  Update: {
                    "bucket"?: string,"created_at"?: string,"file_name"?: string,"id"?: string,"mime"?: string,"object_key"?: string,"sha256"?: string,"size_bytes"?: number,"ticket_id"?: string,"uploaded_by_token_id"?: string | null,"uploaded_by_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_attachments_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "ticket_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_attachments_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_attachments_uploaded_by_token_id_fkey"
      columns: ["uploaded_by_token_id"]
isOneToOne: false
      referencedRelation: "api_tokens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_attachments_uploaded_by_user_id_fkey"
      columns: ["uploaded_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_categories": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"id": string,"name": string,"parent_id": string | null,"product_id": string | null,"updated_at": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"name": string,"parent_id"?: string | null,"product_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"parent_id"?: string | null,"product_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "ticket_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_categories_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_comments": {
                  Row: {
                    "author_token_id": string | null,"author_user_id": string | null,"body": string | null,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"ticket_id": string
                  }
                  Insert: {
                    "author_token_id"?: string | null,"author_user_id"?: string | null,"body"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"ticket_id": string
                  }
                  Update: {
                    "author_token_id"?: string | null,"author_user_id"?: string | null,"body"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_comments_author_token_id_fkey"
      columns: ["author_token_id"]
isOneToOne: false
      referencedRelation: "api_tokens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_comments_author_user_id_fkey"
      columns: ["author_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_comments_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "ticket_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_comments_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_events": {
                  Row: {
                    "actor_token_id": string | null,"actor_type": string,"actor_user_id": string | null,"event_key": string | null,"event_type": string,"id": string,"metadata": NonNullable<Json>,"occurred_at": string,"seq": number,"ticket_id": string
                  }
                  Insert: {
                    "actor_token_id"?: string | null,"actor_type": string,"actor_user_id"?: string | null,"event_key"?: string | null,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"seq"?: number,"ticket_id": string
                  }
                  Update: {
                    "actor_token_id"?: string | null,"actor_type"?: string,"actor_user_id"?: string | null,"event_key"?: string | null,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"occurred_at"?: string,"seq"?: number,"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_events_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "ticket_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_events_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_status_history": {
                  Row: {
                    "actor_token_id": string | null,"actor_type": string,"actor_user_id": string | null,"from_status": string | null,"id": string,"occurred_at": string,"reason": string | null,"seq": number,"ticket_id": string,"to_status": string
                  }
                  Insert: {
                    "actor_token_id"?: string | null,"actor_type": string,"actor_user_id"?: string | null,"from_status"?: string | null,"id"?: string,"occurred_at"?: string,"reason"?: string | null,"seq"?: number,"ticket_id": string,"to_status": string
                  }
                  Update: {
                    "actor_token_id"?: string | null,"actor_type"?: string,"actor_user_id"?: string | null,"from_status"?: string | null,"id"?: string,"occurred_at"?: string,"reason"?: string | null,"seq"?: number,"ticket_id"?: string,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_status_history_from_fkey"
      columns: ["from_status"]
isOneToOne: false
      referencedRelation: "ticket_statuses"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "ticket_status_history_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "ticket_queue"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_status_history_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_status_history_to_fkey"
      columns: ["to_status"]
isOneToOne: false
      referencedRelation: "ticket_statuses"
      referencedColumns: ["key"]
    }
                  ]
                },"ticket_status_transitions": {
                  Row: {
                    "from_status": string,"to_status": string
                  }
                  Insert: {
                    "from_status": string,"to_status": string
                  }
                  Update: {
                    "from_status"?: string,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_status_transitions_from_fkey"
      columns: ["from_status"]
isOneToOne: false
      referencedRelation: "ticket_statuses"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "ticket_status_transitions_to_fkey"
      columns: ["to_status"]
isOneToOne: false
      referencedRelation: "ticket_statuses"
      referencedColumns: ["key"]
    }
                  ]
                },"ticket_statuses": {
                  Row: {
                    "color": string,"is_terminal": boolean,"key": string,"label": string,"position": number,"sla_mode": string,"updated_at": string
                  }
                  Insert: {
                    "color": string,"is_terminal": boolean,"key": string,"label": string,"position": number,"sla_mode": string,"updated_at"?: string
                  }
                  Update: {
                    "color"?: string,"is_terminal"?: boolean,"key"?: string,"label"?: string,"position"?: number,"sla_mode"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tickets": {
                  Row: {
                    "ai_triage": Json | null,"assigned_to_user_id": string | null,"category_id": string | null,"closed_at": string | null,"contact_id": string,"contract_id": string | null,"conversation_id": string,"created_at": string,"created_by_token_id": string | null,"created_by_user_id": string | null,"customer_id": string | null,"description": string | null,"external_id": string | null,"first_ai_response_at": string | null,"first_responded_at": string | null,"first_response_breached_at": string | null,"first_response_due_at": string,"id": string,"idempotency_key": string | null,"number": number,"priority": string,"product_id": string | null,"reopened_count": number,"resolution_breached_at": string | null,"resolution_due_at": string,"resolved_at": string | null,"search_title": string | null,"sla_first_response_minutes": number,"sla_paused_at": string | null,"sla_paused_seconds": number,"sla_resolution_minutes": number,"sla_warn_pct": number,"source": string,"status": string,"title": string,"updated_at": string,"version": number
                  }
                  Insert: {
                    "ai_triage"?: Json | null,"assigned_to_user_id"?: string | null,"category_id"?: string | null,"closed_at"?: string | null,"contact_id": string,"contract_id"?: string | null,"conversation_id": string,"created_at"?: string,"created_by_token_id"?: string | null,"created_by_user_id"?: string | null,"customer_id"?: string | null,"description"?: string | null,"external_id"?: string | null,"first_ai_response_at"?: string | null,"first_responded_at"?: string | null,"first_response_breached_at"?: string | null,"first_response_due_at": string,"id"?: string,"idempotency_key"?: string | null,"number"?: never,"priority": string,"product_id"?: string | null,"reopened_count"?: number,"resolution_breached_at"?: string | null,"resolution_due_at": string,"resolved_at"?: string | null,"search_title"?: never,"sla_first_response_minutes": number,"sla_paused_at"?: string | null,"sla_paused_seconds"?: number,"sla_resolution_minutes": number,"sla_warn_pct": number,"source": string,"status"?: string,"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "ai_triage"?: Json | null,"assigned_to_user_id"?: string | null,"category_id"?: string | null,"closed_at"?: string | null,"contact_id"?: string,"contract_id"?: string | null,"conversation_id"?: string,"created_at"?: string,"created_by_token_id"?: string | null,"created_by_user_id"?: string | null,"customer_id"?: string | null,"description"?: string | null,"external_id"?: string | null,"first_ai_response_at"?: string | null,"first_responded_at"?: string | null,"first_response_breached_at"?: string | null,"first_response_due_at"?: string,"id"?: string,"idempotency_key"?: string | null,"number"?: never,"priority"?: string,"product_id"?: string | null,"reopened_count"?: number,"resolution_breached_at"?: string | null,"resolution_due_at"?: string,"resolved_at"?: string | null,"search_title"?: never,"sla_first_response_minutes"?: number,"sla_paused_at"?: string | null,"sla_paused_seconds"?: number,"sla_resolution_minutes"?: number,"sla_warn_pct"?: number,"source"?: string,"status"?: string,"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "tickets_assigned_to_user_id_fkey"
      columns: ["assigned_to_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "ticket_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "support_contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_created_by_token_id_fkey"
      columns: ["created_by_token_id"]
isOneToOne: false
      referencedRelation: "api_tokens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_created_by_user_id_fkey"
      columns: ["created_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_priority_fkey"
      columns: ["priority"]
isOneToOne: false
      referencedRelation: "sla_policies"
      referencedColumns: ["priority"]
    },{
      foreignKeyName: "tickets_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_status_fkey"
      columns: ["status"]
isOneToOne: false
      referencedRelation: "ticket_statuses"
      referencedColumns: ["key"]
    }
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
            "ticket_queue": {
                  Row: {
                    "assigned_to_user_id": string | null,"category_id": string | null,"closed_at": string | null,"contact_id": string | null,"contract_id": string | null,"conversation_id": string | null,"created_at": string | null,"created_by_user_id": string | null,"customer_id": string | null,"description": string | null,"first_ai_response_at": string | null,"first_responded_at": string | null,"first_response_due_at": string | null,"first_response_overdue": boolean | null,"id": string | null,"is_terminal": boolean | null,"last_inbound_at": string | null,"next_due_at": string | null,"number": number | null,"priority": string | null,"priority_rank": number | null,"product_id": string | null,"reopened_count": number | null,"replied_after_resolve": boolean | null,"resolution_due_at": string | null,"resolution_overdue": boolean | null,"resolved_at": string | null,"search_text": string | null,"sla_at_risk": boolean | null,"sla_breached": boolean | null,"sla_first_response_minutes": number | null,"sla_mode": string | null,"sla_paused_at": string | null,"sla_paused_seconds": number | null,"sla_resolution_minutes": number | null,"sla_warn_pct": number | null,"source": string | null,"status": string | null,"title": string | null,"updated_at": string | null,"version": number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tickets_assigned_to_user_id_fkey"
      columns: ["assigned_to_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "ticket_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "support_contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "chat_conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_created_by_user_id_fkey"
      columns: ["created_by_user_id"]
isOneToOne: false
      referencedRelation: "app_users"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_priority_fkey"
      columns: ["priority"]
isOneToOne: false
      referencedRelation: "sla_policies"
      referencedColumns: ["priority"]
    },{
      foreignKeyName: "tickets_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_status_fkey"
      columns: ["status"]
isOneToOne: false
      referencedRelation: "ticket_statuses"
      referencedColumns: ["key"]
    }
                  ]
                }
          }
          Functions: {
            "assert_contract_refs":
{ Args: { "p_contract_id": string,"p_plan_id": string,"p_product_ids": (string)[] }; Returns: undefined
                           },
"assert_security_baseline":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"assert_ticket_refs":
{ Args: { "p_category_id": string,"p_current_category_id": string,"p_current_product_id": string,"p_product_id": string }; Returns: undefined
                           },
"clear_chat_conversation":
{ Args: { "p_conversation_id": string }; Returns: Json
                           },
"create_app_user":
{ Args: { "p_apelido_atendimento"?: string,"p_assinar_mensagens"?: boolean,"p_avatar_color": string,"p_email": string,"p_must_change_password"?: boolean,"p_name": string,"p_password": string,"p_role": string }; Returns: {
              "avatar_color": string,"avatar_url": string,"created_at": string,"email": string,"id": string,"is_active": boolean,"name": string,"role": string
            }[]
                           },
"create_support_contract":
{ Args: { "p_actor_id": string,"p_billing_day": number,"p_customer_id": string,"p_ends_on"?: string,"p_monthly_amount": number,"p_plan_id"?: string,"p_product_ids": (string)[],"p_starts_on": string,"p_status": string }; Returns: string
                           },
"create_ticket":
{ Args: { "p_actor_token_id"?: string,"p_actor_user_id"?: string,"p_ai_triage"?: Json,"p_assigned_to_user_id"?: string,"p_category_id"?: string,"p_conversation_id": string,"p_description"?: string,"p_external_id"?: string,"p_idempotency_key"?: string,"p_priority"?: string,"p_product_id"?: string,"p_set_active"?: boolean,"p_source"?: string,"p_status"?: string,"p_take_over"?: boolean,"p_title": string }; Returns: Json
                           },
"delete_app_environment_variable":
{ Args: { "p_name": string }; Returns: boolean
                           },
"delete_app_user":
{ Args: { "p_actor_id": string,"p_id": string }; Returns: undefined
                           },
"ensure_chat_integration_secret":
{ Args: { "p_candidate": string,"p_integration_id": string,"p_kind": string }; Returns: string
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
"get_support_contract_amounts":
{ Args: { "p_actor_id": string,"p_customer_id": string }; Returns: {
              "contract_id": string,"monthly_amount": number
            }[]
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
"require_active_admin":
{ Args: { "p_actor_id": string }; Returns: undefined
                           },
"require_ticket_actor":
{ Args: { "p_token_id": string,"p_user_id": string }; Returns: string
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
"set_support_contract_status":
{ Args: { "p_actor_id": string,"p_contract_id": string,"p_ends_on"?: string,"p_status": string }; Returns: Json
                           },
"ticket_apply_take_over":
{ Args: { "p_actor_user_id": string,"p_ticket_id": string }; Returns: boolean
                           },
"ticket_apply_transition":
{ Args: { "p_actor_token_id": string,"p_actor_type": string,"p_actor_user_id": string,"p_reason": string,"p_ticket": Database["public"]['Tables']["tickets"]['Row'],"p_to": string }; Returns: {
              "ai_triage": Json | null,
"assigned_to_user_id": string | null,
"category_id": string | null,
"closed_at": string | null,
"contact_id": string,
"contract_id": string | null,
"conversation_id": string,
"created_at": string,
"created_by_token_id": string | null,
"created_by_user_id": string | null,
"customer_id": string | null,
"description": string | null,
"external_id": string | null,
"first_ai_response_at": string | null,
"first_responded_at": string | null,
"first_response_breached_at": string | null,
"first_response_due_at": string,
"id": string,
"idempotency_key": string | null,
"number": number,
"priority": string,
"product_id": string | null,
"reopened_count": number,
"resolution_breached_at": string | null,
"resolution_due_at": string,
"resolved_at": string | null,
"search_title": string | null,
"sla_first_response_minutes": number,
"sla_paused_at": string | null,
"sla_paused_seconds": number,
"sla_resolution_minutes": number,
"sla_warn_pct": number,
"source": string,
"status": string,
"title": string,
"updated_at": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "tickets"
        isOneToOne: true
        isSetofReturn: false
      } },
"ticket_assign":
{ Args: { "p_actor_token_id"?: string,"p_actor_user_id"?: string,"p_assignee_id"?: string,"p_expected_version": number,"p_ticket_id": string }; Returns: Json
                           },
"ticket_current_contract":
{ Args: { "p_customer_id": string }; Returns: string
                           },
"ticket_record_event":
{ Args: { "p_actor_token_id": string,"p_actor_type": string,"p_actor_user_id": string,"p_event_key"?: string,"p_event_type": string,"p_metadata"?: Json,"p_ticket_id": string }; Returns: undefined
                           },
"ticket_set_active":
{ Args: { "p_actor_token_id"?: string,"p_actor_user_id"?: string,"p_conversation_id": string,"p_ticket_id"?: string }; Returns: Json
                           },
"ticket_summary":
{ Args: { "p_ticket_id": string }; Returns: Json
                           },
"ticket_take_over":
{ Args: { "p_actor_user_id": string,"p_reassign"?: boolean,"p_ticket_id": string }; Returns: Json
                           },
"ticket_transition":
{ Args: { "p_actor_token_id"?: string,"p_actor_user_id"?: string,"p_expected_version": number,"p_reason"?: string,"p_ticket_id": string,"p_to": string }; Returns: Json
                           },
"ticket_update":
{ Args: { "p_actor_token_id"?: string,"p_actor_user_id"?: string,"p_expected_version": number,"p_patch": Json,"p_ticket_id": string }; Returns: Json
                           },
"update_app_user":
{ Args: { "p_actor_id": string,"p_apelido_atendimento"?: string,"p_assinar_mensagens"?: boolean,"p_avatar_color": string,"p_avatar_url": string,"p_email": string,"p_id": string,"p_is_active": boolean,"p_name": string,"p_role": string }; Returns: {
              "avatar_color": string,"avatar_url": string,"created_at": string,"email": string,"id": string,"is_active": boolean,"name": string,"role": string
            }[]
                           },
"update_support_contract":
{ Args: { "p_actor_id": string,"p_billing_day": number,"p_contract_id": string,"p_ends_on"?: string,"p_monthly_amount": number,"p_plan_id"?: string,"p_product_ids": (string)[],"p_starts_on": string }; Returns: undefined
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

