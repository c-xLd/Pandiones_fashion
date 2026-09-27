import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client. BYPASSES Row Level Security — use only in trusted
 * server code (background worker, audit logging, membership management)
 * after performing explicit authorization checks, and always scope queries
 * by organization_id.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(supabaseUrl(), supabaseSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return admin;
}
