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
      agent_configs: {
        Row: {
          created_at: string
          enabled: boolean
          followup_inactivity_minutes: number | null
          followup_max_per_conversation: number
          groq_api_key: string | null
          groq_model: string
          opening_message_template: string | null
          system_prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          followup_inactivity_minutes?: number | null
          followup_max_per_conversation?: number
          groq_api_key?: string | null
          groq_model?: string
          opening_message_template?: string | null
          system_prompt?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          followup_inactivity_minutes?: number | null
          followup_max_per_conversation?: number
          groq_api_key?: string | null
          groq_model?: string
          opening_message_template?: string | null
          system_prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          ai_enabled: boolean
          auto_followup_count: number
          client_type: string | null
          closed_at: string | null
          commission_eligible: boolean
          contact_name: string | null
          contact_phone: string
          created_at: string
          deal_value: number | null
          due_day: number | null
          human_takeover_at: string | null
          id: string
          inactivity_followup_at: string | null
          installment_plan: number | null
          instance_id: string | null
          last_message_at: string
          lost_at: string | null
          stage_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_enabled?: boolean
          auto_followup_count?: number
          client_type?: string | null
          closed_at?: string | null
          commission_eligible?: boolean
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          deal_value?: number | null
          due_day?: number | null
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          installment_plan?: number | null
          instance_id?: string | null
          last_message_at?: string
          lost_at?: string | null
          stage_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_enabled?: boolean
          auto_followup_count?: number
          client_type?: string | null
          closed_at?: string | null
          commission_eligible?: boolean
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          deal_value?: number | null
          due_day?: number | null
          human_takeover_at?: string | null
          id?: string
          inactivity_followup_at?: string | null
          installment_plan?: number | null
          instance_id?: string | null
          last_message_at?: string
          lost_at?: string | null
          stage_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      followups: {
        Row: {
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          kind: string
          send_at: string
          sent_at: string | null
          status: string
          text_override: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          send_at: string
          sent_at?: string | null
          status?: string
          text_override?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          send_at?: string
          sent_at?: string | null
          status?: string
          text_override?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          direction: string
          id: string
          sender: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          direction: string
          id?: string
          sender: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          sender?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_lost: boolean
          is_loyalty: boolean
          is_won: boolean
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_lost?: boolean
          is_loyalty?: boolean
          is_won?: boolean
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_lost?: boolean
          is_loyalty?: boolean
          is_won?: boolean
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed: boolean
          seller_level: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          seller_level?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean
          seller_level?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sale_installments: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          installment_no: number
          paid_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          installment_no: number
          paid_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          installment_no?: number
          paid_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_installments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          id: string
          instance_token: string | null
          last_disconnected_at: string | null
          name: string
          phone: string | null
          profile_name: string | null
          server_url: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_token?: string | null
          last_disconnected_at?: string | null
          name: string
          phone?: string | null
          profile_name?: string | null
          server_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_token?: string | null
          last_disconnected_at?: string | null
          name?: string
          phone?: string | null
          profile_name?: string | null
          server_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      seed_pipeline_stages: { Args: { _user_id: string }; Returns: undefined }
      get_team_settings: { Args: Record<string, never>; Returns: { key: string; value: string }[] }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      crm_status: "conversas" | "negociando" | "ganho" | "perda"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
      crm_status: ["conversas", "negociando", "ganho", "perda"],
    },
  },
} as const
