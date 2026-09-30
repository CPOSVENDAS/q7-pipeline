import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";

/**
 * Cancela todos os follow-ups pendentes de uma conversa.
 * Usado quando o cliente responde (não há mais razão pra reengajar).
 */
export async function cancelPendingFollowups(
  admin: SupabaseClient,
  conversationId: string,
) {
  await admin
    .from("followups")
    .update({ status: "cancelled" })
    .eq("conversation_id", conversationId)
    .eq("status", "pending");
}

/**
 * Agenda um auto-follow-up por inatividade após uma resposta da IA/humano,
 * se o usuário ativou essa opção e ainda não atingiu o limite.
 * Cancela qualquer pendente anterior antes de criar o novo.
 */
export async function scheduleInactivityFollowup(params: {
  admin: SupabaseClient;
  userId: string;
  conversationId: string;
  currentAutoCount: number;
}) {
  const { admin, userId, conversationId, currentAutoCount } = params;

  // Proteção: só agenda se a IA continua ativa nessa conversa
  const { data: conv } = await admin
    .from("conversations")
    .select("ai_enabled")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv?.ai_enabled) return;

  const { data: agent } = await admin
    .from("agent_configs")
    .select("followup_inactivity_minutes, followup_max_per_conversation")
    .eq("user_id", userId)
    .maybeSingle();

  const minutes = agent?.followup_inactivity_minutes ?? 0;
  const max = agent?.followup_max_per_conversation ?? 1;
  if (!minutes || minutes <= 0) return;
  if (currentAutoCount >= max) return;

  // Cancela qualquer pendente e cria o novo
  await cancelPendingFollowups(admin, conversationId);

  const sendAt = new Date(Date.now() + minutes * 60_000).toISOString();

  await admin.from("followups").insert({
    user_id: userId,
    conversation_id: conversationId,
    send_at: sendAt,
    status: "pending",
    kind: "auto_inactivity",
  });

  await admin
    .from("conversations")
    .update({ inactivity_followup_at: sendAt })
    .eq("id", conversationId);
}