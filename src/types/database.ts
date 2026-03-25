export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      games: {
        Row: {
          id: string;
          title: Json;
          description: Json | null;
          cover_image: string | null;
          city: string | null;
          difficulty: number;
          estimated_duration_min: number | null;
          is_published: boolean;
          max_hints_per_step: number;
          hint_penalty_seconds: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: Json;
          description?: Json | null;
          cover_image?: string | null;
          city?: string | null;
          difficulty?: number;
          estimated_duration_min?: number | null;
          is_published?: boolean;
          max_hints_per_step?: number;
          hint_penalty_seconds?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: Json;
          description?: Json | null;
          cover_image?: string | null;
          city?: string | null;
          difficulty?: number;
          estimated_duration_min?: number | null;
          is_published?: boolean;
          max_hints_per_step?: number;
          hint_penalty_seconds?: number;
          updated_at?: string;
        };
      };
      game_steps: {
        Row: {
          id: string;
          game_id: string;
          step_order: number;
          title: Json;
          riddle_text: Json;
          riddle_image: string | null;
          answer_text: Json | null;
          latitude: number;
          longitude: number;
          validation_radius_meters: number;
          has_photo_challenge: boolean;
          photo_reference: string | null;
          hints: Json;
          bonus_time_seconds: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          step_order: number;
          title: Json;
          riddle_text: Json;
          riddle_image?: string | null;
          answer_text?: Json | null;
          latitude: number;
          longitude: number;
          validation_radius_meters?: number;
          has_photo_challenge?: boolean;
          photo_reference?: string | null;
          hints?: Json;
          bonus_time_seconds?: number;
          created_at?: string;
        };
        Update: {
          game_id?: string;
          step_order?: number;
          title?: Json;
          riddle_text?: Json;
          riddle_image?: string | null;
          answer_text?: Json | null;
          latitude?: number;
          longitude?: number;
          validation_radius_meters?: number;
          has_photo_challenge?: boolean;
          photo_reference?: string | null;
          hints?: Json;
          bonus_time_seconds?: number;
        };
      };
      activation_codes: {
        Row: {
          id: string;
          code: string;
          game_id: string;
          is_single_use: boolean;
          max_uses: number;
          current_uses: number;
          team_name: string | null;
          expires_at: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          code: string;
          game_id: string;
          is_single_use?: boolean;
          max_uses?: number;
          current_uses?: number;
          team_name?: string | null;
          expires_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          code?: string;
          game_id?: string;
          is_single_use?: boolean;
          max_uses?: number;
          current_uses?: number;
          team_name?: string | null;
          expires_at?: string | null;
        };
      };
      game_sessions: {
        Row: {
          id: string;
          activation_code_id: string;
          game_id: string;
          player_name: string;
          team_name: string | null;
          status: "active" | "completed" | "abandoned";
          current_step: number;
          total_steps: number;
          started_at: string;
          completed_at: string | null;
          total_time_seconds: number | null;
          total_hints_used: number;
          total_penalty_seconds: number;
          final_score: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          activation_code_id: string;
          game_id: string;
          player_name: string;
          team_name?: string | null;
          status?: "active" | "completed" | "abandoned";
          current_step?: number;
          total_steps: number;
          started_at?: string;
          completed_at?: string | null;
          total_time_seconds?: number | null;
          total_hints_used?: number;
          total_penalty_seconds?: number;
          final_score?: number | null;
          created_at?: string;
        };
        Update: {
          activation_code_id?: string;
          game_id?: string;
          player_name?: string;
          team_name?: string | null;
          status?: "active" | "completed" | "abandoned";
          current_step?: number;
          total_steps?: number;
          completed_at?: string | null;
          total_time_seconds?: number | null;
          total_hints_used?: number;
          total_penalty_seconds?: number;
          final_score?: number | null;
        };
      };
      step_completions: {
        Row: {
          id: string;
          session_id: string;
          step_id: string;
          step_order: number;
          started_at: string;
          completed_at: string;
          time_seconds: number | null;
          hints_used: number;
          penalty_seconds: number;
          photo_url: string | null;
          photo_validated: boolean | null;
          latitude: number | null;
          longitude: number | null;
          distance_meters: number | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          step_id: string;
          step_order: number;
          started_at: string;
          completed_at?: string;
          time_seconds?: number | null;
          hints_used?: number;
          penalty_seconds?: number;
          photo_url?: string | null;
          photo_validated?: boolean | null;
          latitude?: number | null;
          longitude?: number | null;
          distance_meters?: number | null;
        };
        Update: {
          completed_at?: string;
          time_seconds?: number | null;
          hints_used?: number;
          penalty_seconds?: number;
          photo_url?: string | null;
          photo_validated?: boolean | null;
          latitude?: number | null;
          longitude?: number | null;
          distance_meters?: number | null;
        };
      };
      admin_users: {
        Row: {
          id: string;
          role: "admin" | "super_admin";
          created_at: string;
        };
        Insert: {
          id: string;
          role?: "admin" | "super_admin";
          created_at?: string;
        };
        Update: {
          role?: "admin" | "super_admin";
        };
      };
    };
    Views: {
      leaderboard: {
        Row: {
          session_id: string;
          player_name: string;
          team_name: string | null;
          game_id: string;
          game_title: string;
          city: string | null;
          total_time_seconds: number | null;
          total_hints_used: number;
          total_penalty_seconds: number;
          final_score: number | null;
          completed_at: string | null;
          rank: number;
        };
      };
    };
    Functions: {
      activate_code: {
        Args: {
          p_code: string;
          p_player_name: string;
          p_team_name?: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
  };
}

export type Game = Database["public"]["Tables"]["games"]["Row"];
export type GameStep = Database["public"]["Tables"]["game_steps"]["Row"];
export type ActivationCode = Database["public"]["Tables"]["activation_codes"]["Row"];
export type GameSession = Database["public"]["Tables"]["game_sessions"]["Row"];
export type StepCompletion = Database["public"]["Tables"]["step_completions"]["Row"];
export type LeaderboardEntry = Database["public"]["Views"]["leaderboard"]["Row"];
