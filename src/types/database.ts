// File sinh tự động bằng `supabase gen types typescript` (npm run gen:types) – không sửa tay.
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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_alerts: {
        Row: {
          created_at: string
          id: number
          kind: string
          message: string
          resolved_at: string | null
          resolved_by: string | null
          tour_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          kind: string
          message: string
          resolved_at?: string | null
          resolved_by?: string | null
          tour_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          message?: string
          resolved_at?: string | null
          resolved_by?: string | null
          tour_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_alerts_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "earning_lines"
            referencedColumns: ["tour_id"]
          },
          {
            foreignKeyName: "admin_alerts_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_recipients: {
        Row: {
          announcement_id: string
          read_at: string | null
          technician_id: string
        }
        Insert: {
          announcement_id: string
          read_at?: string | null
          technician_id: string
        }
        Update: {
          announcement_id?: string
          read_at?: string | null
          technician_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_recipients_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_recipients_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          target: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          target: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          target?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          decline_reasons: string[]
          id: boolean
          imbalance_threshold_percent: number
          overdue_alert_minutes: number
          payroll_start_day: number
          offer_timeout_seconds: number
          random_pool_size: number
          requested_threshold_percent: number
          shift_hours: Json
          updated_at: string
          updated_by: string | null
          weights: Json
        }
        Insert: {
          decline_reasons?: string[]
          id?: boolean
          imbalance_threshold_percent?: number
          overdue_alert_minutes?: number
          payroll_start_day?: number
          offer_timeout_seconds?: number
          random_pool_size?: number
          requested_threshold_percent?: number
          shift_hours?: Json
          updated_at?: string
          updated_by?: string | null
          weights?: Json
        }
        Update: {
          decline_reasons?: string[]
          id?: boolean
          imbalance_threshold_percent?: number
          overdue_alert_minutes?: number
          payroll_start_day?: number
          offer_timeout_seconds?: number
          random_pool_size?: number
          requested_threshold_percent?: number
          shift_hours?: Json
          updated_at?: string
          updated_by?: string | null
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      earning_disputes: {
        Row: {
          admin_reply: string | null
          created_at: string
          id: string
          message: string
          month: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          technician_id: string
          tour_id: string | null
        }
        Insert: {
          admin_reply?: string | null
          created_at?: string
          id?: string
          message: string
          month: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          technician_id: string
          tour_id?: string | null
        }
        Update: {
          admin_reply?: string | null
          created_at?: string
          id?: string
          message?: string
          month?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          technician_id?: string
          tour_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "earning_disputes_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earning_disputes_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earning_disputes_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "earning_lines"
            referencedColumns: ["tour_id"]
          },
          {
            foreignKeyName: "earning_disputes_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          locked_at: string | null
          locked_by: string | null
          month: string
          status: Database["public"]["Enums"]["payroll_status"]
        }
        Insert: {
          locked_at?: string | null
          locked_by?: string | null
          month: string
          status?: Database["public"]["Enums"]["payroll_status"]
        }
        Update: {
          locked_at?: string | null
          locked_by?: string | null
          month?: string
          status?: Database["public"]["Enums"]["payroll_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          shift: Database["public"]["Enums"]["shift_type"] | null
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          shift?: Database["public"]["Enums"]["shift_type"] | null
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          shift?: Database["public"]["Enums"]["shift_type"] | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          requires_skill: boolean
          sort_order: number
          tour_fee: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          requires_skill?: boolean
          sort_order?: number
          tour_fee: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          requires_skill?: boolean
          sort_order?: number
          tour_fee?: number
          updated_at?: string
        }
        Relationships: []
      }
      shift_checkins: {
        Row: {
          check_in_at: string
          check_out_at: string | null
          id: string
          shift: Database["public"]["Enums"]["shift_type"]
          technician_id: string
          work_date: string
        }
        Insert: {
          check_in_at?: string
          check_out_at?: string | null
          id?: string
          shift: Database["public"]["Enums"]["shift_type"]
          technician_id: string
          work_date: string
        }
        Update: {
          check_in_at?: string
          check_out_at?: string | null
          id?: string
          shift?: Database["public"]["Enums"]["shift_type"]
          technician_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_checkins_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_schedules: {
        Row: {
          shift: Database["public"]["Enums"]["shift_type"]
          technician_id: string
          updated_at: string
          updated_by: string | null
          work_date: string
        }
        Insert: {
          shift: Database["public"]["Enums"]["shift_type"]
          technician_id: string
          updated_at?: string
          updated_by?: string | null
          work_date: string
        }
        Update: {
          shift?: Database["public"]["Enums"]["shift_type"]
          technician_id?: string
          updated_at?: string
          updated_by?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_schedules_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_schedules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      technician_skills: {
        Row: {
          created_at: string
          service_id: string
          technician_id: string
        }
        Insert: {
          created_at?: string
          service_id: string
          technician_id: string
        }
        Update: {
          created_at?: string
          service_id?: string
          technician_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "technician_skills_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "technician_skills_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_assignments: {
        Row: {
          accepted_at: string
          completed_at: string | null
          created_at: string
          earned_amount: number
          id: string
          share_percent: number
          status: Database["public"]["Enums"]["assignment_status"]
          technician_id: string
          tour_id: string
        }
        Insert: {
          accepted_at?: string
          completed_at?: string | null
          created_at?: string
          earned_amount?: number
          id?: string
          share_percent: number
          status?: Database["public"]["Enums"]["assignment_status"]
          technician_id: string
          tour_id: string
        }
        Update: {
          accepted_at?: string
          completed_at?: string | null
          created_at?: string
          earned_amount?: number
          id?: string
          share_percent?: number
          status?: Database["public"]["Enums"]["assignment_status"]
          technician_id?: string
          tour_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_assignments_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_assignments_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "earning_lines"
            referencedColumns: ["tour_id"]
          },
          {
            foreignKeyName: "tour_assignments_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: number
          reason: string | null
          tour_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: never
          reason?: string | null
          tour_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: never
          reason?: string | null
          tour_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_audit_logs_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "earning_lines"
            referencedColumns: ["tour_id"]
          },
          {
            foreignKeyName: "tour_audit_logs_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_code_counters: {
        Row: {
          day: string
          last_value: number
        }
        Insert: {
          day: string
          last_value: number
        }
        Update: {
          day?: string
          last_value?: number
        }
        Relationships: []
      }
      tour_items: {
        Row: {
          duration_snapshot: number
          fee_snapshot: number
          id: string
          position: number
          service_id: string
          service_name_snapshot: string
          tour_id: string
        }
        Insert: {
          duration_snapshot: number
          fee_snapshot: number
          id?: string
          position?: number
          service_id: string
          service_name_snapshot: string
          tour_id: string
        }
        Update: {
          duration_snapshot?: number
          fee_snapshot?: number
          id?: string
          position?: number
          service_id?: string
          service_name_snapshot?: string
          tour_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_items_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "earning_lines"
            referencedColumns: ["tour_id"]
          },
          {
            foreignKeyName: "tour_items_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_offers: {
        Row: {
          decline_reason: string | null
          expires_at: string
          id: string
          offered_at: string
          offered_by: string | null
          responded_at: string | null
          round: number
          share_percent: number
          status: Database["public"]["Enums"]["offer_status"]
          technician_id: string
          tour_id: string
        }
        Insert: {
          decline_reason?: string | null
          expires_at: string
          id?: string
          offered_at?: string
          offered_by?: string | null
          responded_at?: string | null
          round?: number
          share_percent?: number
          status?: Database["public"]["Enums"]["offer_status"]
          technician_id: string
          tour_id: string
        }
        Update: {
          decline_reason?: string | null
          expires_at?: string
          id?: string
          offered_at?: string
          offered_by?: string | null
          responded_at?: string | null
          round?: number
          share_percent?: number
          status?: Database["public"]["Enums"]["offer_status"]
          technician_id?: string
          tour_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_offers_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_offers_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tour_offers_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "earning_lines"
            referencedColumns: ["tour_id"]
          },
          {
            foreignKeyName: "tour_offers_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      tours: {
        Row: {
          assign_mode: Database["public"]["Enums"]["assign_mode"]
          cancelled_at: string | null
          cancelled_reason: string | null
          code: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_gender: Database["public"]["Enums"]["gender_type"]
          customer_name: string
          customer_phone: string | null
          external_ref: string | null
          id: string
          is_requested: boolean
          note: string | null
          overdue_notified_at: string | null
          requested_share_percent: number
          requested_technician_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["tour_status"]
          team_size: number
          updated_at: string
        }
        Insert: {
          assign_mode?: Database["public"]["Enums"]["assign_mode"]
          cancelled_at?: string | null
          cancelled_reason?: string | null
          code: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_gender?: Database["public"]["Enums"]["gender_type"]
          customer_name: string
          customer_phone?: string | null
          external_ref?: string | null
          id?: string
          is_requested?: boolean
          note?: string | null
          overdue_notified_at?: string | null
          requested_share_percent?: number
          requested_technician_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["tour_status"]
          team_size?: number
          updated_at?: string
        }
        Update: {
          assign_mode?: Database["public"]["Enums"]["assign_mode"]
          cancelled_at?: string | null
          cancelled_reason?: string | null
          code?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_gender?: Database["public"]["Enums"]["gender_type"]
          customer_name?: string
          customer_phone?: string | null
          external_ref?: string | null
          id?: string
          is_requested?: boolean
          note?: string | null
          overdue_notified_at?: string | null
          requested_share_percent?: number
          requested_technician_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["tour_status"]
          team_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tours_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tours_requested_technician_id_fkey"
            columns: ["requested_technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      earning_lines: {
        Row: {
          amount: number | null
          assignment_id: string | null
          code: string | null
          completed_at: string | null
          customer_name: string | null
          is_requested: boolean | null
          month: string | null
          services: string | null
          share_percent: number | null
          started_at: string | null
          team_size: number | null
          technician_id: string | null
          technician_name: string | null
          tour_id: string | null
          tour_total: number | null
          work_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_assignments_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings_daily: {
        Row: {
          amount: number | null
          requested_tours: number | null
          technician_id: string | null
          technician_name: string | null
          tours: number | null
          work_date: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_assignments_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings_monthly: {
        Row: {
          amount: number | null
          month: string | null
          requested_amount: number | null
          requested_tours: number | null
          technician_id: string | null
          technician_name: string | null
          tours: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tour_assignments_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _after_offer_failed: { Args: { p_offer_id: string }; Returns: undefined }
      _assert_month_open: { Args: { p_ts: string }; Returns: undefined }
      _create_offer: {
        Args: {
          p_by: string
          p_share: number
          p_tech: string
          p_tour_id: string
        }
        Returns: string
      }
      _dispatch_requested_for: { Args: { p_tech: string }; Returns: undefined }
      _do_check_in: {
        Args: {
          p_shift: Database["public"]["Enums"]["shift_type"]
          p_tech: string
        }
        Returns: undefined
      }
      _do_check_out: { Args: { p_tech: string }; Returns: undefined }
      _is_month_locked: { Args: { p_month: string }; Returns: boolean }
      _kick_dispatch: { Args: { p_tour_id: string }; Returns: undefined }
      _kick_dispatch_if_waiting: { Args: never; Returns: undefined }
      _log: {
        Args: {
          p_action: string
          p_after: Json
          p_before: Json
          p_reason: string
          p_tour_id: string
        }
        Returns: undefined
      }
      _missing_skills: {
        Args: { p_tech: string; p_tour_id: string }
        Returns: string[]
      }
      _next_tour_code: { Args: never; Returns: string }
      _offer_internal: {
        Args: {
          p_allow_queue: boolean
          p_by: string
          p_share: number
          p_tech: string
          p_tour_id: string
        }
        Returns: Json
      }
      _open_share: { Args: { p_tour_id: string }; Returns: number }
      _recompute_tour_earnings: {
        Args: { p_tour_id: string }
        Returns: undefined
      }
      _require_owner: { Args: never; Returns: undefined }
      _require_reason: { Args: { p_reason: string }; Returns: string }
      _require_service_role: { Args: never; Returns: undefined }
      _require_staff: { Args: never; Returns: undefined }
      _require_technician: { Args: never; Returns: undefined }
      _tech_busy_reason: { Args: { p_tech: string }; Returns: string }
      _tour_json: { Args: { p_tour_id: string }; Returns: Json }
      accept_offer: { Args: { p_offer_id: string }; Returns: Json }
      admin_check_in: {
        Args: {
          p_shift: Database["public"]["Enums"]["shift_type"]
          p_technician_id: string
        }
        Returns: undefined
      }
      admin_check_out: { Args: { p_technician_id: string }; Returns: undefined }
      assignment_snapshot: {
        Args: { p_service_ids: string[]; p_tour_id?: string }
        Returns: Json
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      cancel_tour: {
        Args: { p_reason: string; p_tour_id: string }
        Returns: undefined
      }
      check_in: {
        Args: { p_shift: Database["public"]["Enums"]["shift_type"] }
        Returns: undefined
      }
      check_out: { Args: never; Returns: undefined }
      close_stale_checkins: { Args: never; Returns: number }
      complete_tour: { Args: { p_tour_id: string }; Returns: Json }
      create_dispute: {
        Args: { p_message: string; p_month: string; p_tour_id: string }
        Returns: string
      }
      create_tour: { Args: { p: Json }; Returns: Json }
      dashboard_snapshot: { Args: never; Returns: Json }
      decline_offer: {
        Args: { p_offer_id: string; p_reason: string }
        Returns: undefined
      }
      edit_tour: {
        Args: { p: Json; p_reason: string; p_tour_id: string }
        Returns: undefined
      }
      expire_offer: { Args: { p_offer_id: string }; Returns: boolean }
      expire_offers: { Args: never; Returns: number }
      get_tour: {
        Args: { p_code?: string; p_tour_id?: string }
        Returns: Json
      }
      get_vapid_public_key: { Args: never; Returns: string }
      internal_config: { Args: never; Returns: Json }
      internal_set_config: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      is_owner: { Args: never; Returns: boolean }
      is_service_role: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_tour_member: { Args: { p_tour_id: string }; Returns: boolean }
      lock_month: { Args: { p_month: string }; Returns: undefined }
      mark_announcement_read: {
        Args: { p_announcement_id?: string }
        Returns: undefined
      }
      my_snapshot: { Args: never; Returns: Json }
      earnings_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          amount: number
          full_name: string
          is_active: boolean
          requested_amount: number
          requested_tours: number
          technician_id: string
          tours: number
          username: string
        }[]
      }
      pay_period_of_date: { Args: { d: string }; Returns: string }
      payroll_start_day: { Args: never; Returns: number }
      payroll_summary: {
        Args: { p_month: string }
        Returns: {
          amount: number
          full_name: string
          is_active: boolean
          open_disputes: number
          requested_amount: number
          requested_tours: number
          technician_id: string
          tours: number
          username: string
        }[]
      }
      push_targets: { Args: { p_id: string; p_kind: string }; Returns: Json }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      reassign_technician: {
        Args: {
          p_assignment_id: string
          p_new_technician_id: string
          p_reason: string
        }
        Returns: undefined
      }
      resolve_alert: { Args: { p_alert_id: number }; Returns: undefined }
      resolve_dispute: {
        Args: {
          p_id: string
          p_reply: string
          p_status: Database["public"]["Enums"]["dispute_status"]
        }
        Returns: undefined
      }
      set_avatar: {
        Args: { p_avatar_url: string; p_user_id: string }
        Returns: undefined
      }
      send_announcement: {
        Args: { p_body: string; p_technician_ids?: string[]; p_title: string }
        Returns: string
      }
      send_offer: {
        Args: {
          p_share_percent?: number
          p_technician_id: string
          p_tour_id: string
        }
        Returns: Json
      }
      split_fee: {
        Args: { p_shares: number[]; p_total: number }
        Returns: number[]
      }
      system_dispatch_queue: { Args: never; Returns: Json }
      system_no_candidate: { Args: { p_tour_id: string }; Returns: undefined }
      system_remove_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      system_send_offer: {
        Args: { p_technician_id: string; p_tour_id: string }
        Returns: Json
      }
      technician_earnings: {
        Args: { p_from: string; p_technician_id: string; p_to: string }
        Returns: number
      }
      technician_response_stats: {
        Args: { p_from: string; p_to: string }
        Returns: {
          accepted: number
          declined: number
          expired: number
          full_name: string
          offers: number
          technician_id: string
        }[]
      }
      unlock_month: {
        Args: { p_month: string; p_reason: string }
        Returns: undefined
      }
      update_member_profile: {
        Args: {
          p_full_name: string
          p_gender?: Database["public"]["Enums"]["gender_type"]
          p_id: string
          p_phone: string
          p_shift: Database["public"]["Enums"]["shift_type"]
          p_skill_ids: string[]
        }
        Returns: undefined
      }
      vn_date: { Args: { ts: string }; Returns: string }
      vn_day_start: { Args: { d: string }; Returns: string }
      vn_month: { Args: { ts: string }; Returns: string }
      vn_today: { Args: never; Returns: string }
      withdraw_offer: {
        Args: { p_offer_id: string; p_reason?: string }
        Returns: undefined
      }
    }
    Enums: {
      assign_mode: "suggest" | "auto" | "random" | "requested"
      assignment_status: "accepted" | "working" | "done" | "removed"
      dispute_status: "open" | "resolved" | "rejected"
      offer_status:
        | "pending"
        | "accepted"
        | "declined"
        | "expired"
        | "withdrawn"
      payroll_status: "open" | "locked"
      gender_type: "male" | "female"
      shift_type: "morning" | "afternoon" | "full" | "off"
      tour_status:
        | "waiting"
        | "offered"
        | "in_progress"
        | "completed"
        | "cancelled"
      user_role: "owner" | "manager" | "technician"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      assign_mode: ["suggest", "auto", "random", "requested"],
      assignment_status: ["accepted", "working", "done", "removed"],
      dispute_status: ["open", "resolved", "rejected"],
      offer_status: ["pending", "accepted", "declined", "expired", "withdrawn"],
      payroll_status: ["open", "locked"],
      gender_type: ["male", "female"],
      shift_type: ["morning", "afternoon", "full", "off"],
      tour_status: [
        "waiting",
        "offered",
        "in_progress",
        "completed",
        "cancelled",
      ],
      user_role: ["owner", "manager", "technician"],
    },
  },
} as const
