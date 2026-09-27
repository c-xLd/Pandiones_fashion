import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Append-only audit trail for important actions. Written with the service
 * role (users cannot insert or modify audit rows). Never include secrets or
 * raw file contents in metadata.
 */
export async function audit(entry: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from("audit_logs").insert({
    organization_id: entry.organizationId,
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) {
    // Auditing must not break the user action, but failures must be visible.
    console.error("[audit] failed to write audit log", { action: entry.action, error: error.message });
  }
}
