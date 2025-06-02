export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          created_at: string
          last_sign_in: string | null
          is_active: boolean
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          created_at?: string
          last_sign_in?: string | null
          is_active?: boolean
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          created_at?: string
          last_sign_in?: string | null
          is_active?: boolean
        }
      }
      roles: {
        Row: {
          id: number
          name: string
          description: string | null
        }
        Insert: {
          id?: number
          name: string
          description?: string | null
        }
        Update: {
          id?: number
          name?: string
          description?: string | null
        }
      }
      user_roles: {
        Row: {
          user_id: string
          role_id: number
        }
        Insert: {
          user_id: string
          role_id: number
        }
        Update: {
          user_id?: string
          role_id?: number
        }
      }
      parking_lots: {
        Row: {
          id: string
          name: string
          location: string | null
          address: string | null
          total_spaces: number
          owner_id: string | null
          created_at: string
          is_active: boolean
          camera_id: string | null
          config: Json | null
          camera_secret_key: string | null
        }
        Insert: {
          id?: string
          name: string
          location?: string | null
          address?: string | null
          total_spaces: number
          owner_id?: string | null
          created_at?: string
          is_active?: boolean
          camera_id?: string | null
          config?: Json | null
          camera_secret_key?: string | null
        }
        Update: {
          id?: string
          name?: string
          location?: string | null
          address?: string | null
          total_spaces?: number
          owner_id?: string | null
          created_at?: string
          is_active?: boolean
          camera_id?: string | null
          config?: Json | null
          camera_secret_key?: string | null
        }
      }
      parking_spaces: {
        Row: {
          id: string
          parking_lot_id: string
          space_number: string
          type: string
          status: string
          coordinates: Json | null
        }
        Insert: {
          id?: string
          parking_lot_id: string
          space_number: string
          type?: string
          status?: string
          coordinates?: Json | null
        }
        Update: {
          id?: string
          parking_lot_id?: string
          space_number?: string
          type?: string
          status?: string
          coordinates?: Json | null
        }
      }
      detection_sessions: {
        Row: {
          id: string
          parking_lot_id: string
          start_time: string
          end_time: string | null
          status: string
          started_by: string | null
        }
        Insert: {
          id?: string
          parking_lot_id: string
          start_time?: string
          end_time?: string | null
          status?: string
          started_by?: string | null
        }
        Update: {
          id?: string
          parking_lot_id?: string
          start_time?: string
          end_time?: string | null
          status?: string
          started_by?: string | null
        }
      }
      detection_results: {
        Row: {
          id: string
          session_id: string
          timestamp: string
          frame_count: number | null
          frame_path: string | null
          total_occupied_spaces: number | null
          total_empty_spaces: number | null
          total_cars: number | null
          total_large_cars: number | null
        }
        Insert: {
          id?: string
          session_id: string
          timestamp?: string
          frame_count?: number | null
          frame_path?: string | null
          total_occupied_spaces?: number | null
          total_empty_spaces?: number | null
          total_cars?: number | null
          total_large_cars?: number | null
        }
        Update: {
          id?: string
          session_id?: string
          timestamp?: string
          frame_count?: number | null
          frame_path?: string | null
          total_occupied_spaces?: number | null
          total_empty_spaces?: number | null
          total_cars?: number | null
          total_large_cars?: number | null
        }
      }
      space_statuses: {
        Row: {
          id: string
          result_id: string
          space_id: string
          status: string
          duration: number
          vehicle_type: string | null
        }
        Insert: {
          id?: string
          result_id: string
          space_id: string
          status: string
          duration?: number
          vehicle_type?: string | null
        }
        Update: {
          id?: string
          result_id?: string
          space_id?: string
          status?: string
          duration?: number
          vehicle_type?: string | null
        }
      }
    }
    Views: {
      latest_detection_results: {
        Row: {
          id: string
          session_id: string
          timestamp: string
          frame_count: number | null
          frame_path: string | null
          total_occupied_spaces: number | null
          total_empty_spaces: number | null
          total_cars: number | null
          total_large_cars: number | null
          parking_lot_name: string | null
          owner_id: string | null
        }
      }
    }
    Functions: {
      end_detection_session: {
        Args: {
          session_id: string
        }
        Returns: undefined
      }
    }
  }
}
