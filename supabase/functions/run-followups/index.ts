import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAgentConfig, callGroq } from "../_shared/get-ai-config.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";

const BATCH = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ok(body: any = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Devolve para a fila follow-ups "travados" em envio há mais de 10 min (a execução
  // anterior foi interrompida no meio). Sem isso eles ficariam parados para sempre.
  await supabase
    .from("followups")
    .update({ status: "pending" })
    .eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const { data: due, error } = await supabase
    .from("followups")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(BATCH);

  if (error) return ok({ ok: false, error: error.message });
  if (!due?.length) return ok({ processed: 0 });

  const uaz = await getUazapiConfig(); // pode ser null; cada instância pode ter server_url/token próprios

  let processed = 0;
  for (const f of due) {
    try {
      // "Reserva" o follow-up antes de mexer nele: se uma execução demorar mais de 1 min,
      // a próxima do cron não pega o mesmo item e não envia a mensagem em duplicidade.
      const { data: claimed } = await supabase
        .from("followups")
        .update({ status: "sending" })
        .eq("id", f.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) continue;

      const { data: conv } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", f.conversation_id)
        .maybeSingle();

      if (!conv) {
        await supabase.from("followups").update({ status: "cancelled", error: "conversation missing" }).eq("id", f.id);
        continue;
      }

      // Humano no controle → cancela auto-follow-up. Manual (text_override)
      // continua saindo mesmo com IA desligada, pois foi você quem agendou.
      if (conv.ai_enabled === false && f.kind === "auto_inactivity") {
        await supabase
          .from("followups")
          .update({ status: "cancelled", error: "human took over" })
          .eq("id", f.id);
        continue;
      }

      // Instância
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token, server_url")
        .eq("id", conv.instance_id)
        .maybeSingle();
      if (!inst?.instance_token) {
        await supabase.from("followups").update({ status: "failed", error: "no instance token" }).eq("id", f.id);
        continue;
      }

      // Texto: override manual, senão Groq gera reengajamento
      let text = (f.text_override || "").trim();

      if (!text) {
        const agent = await getAgentConfig(conv.user_id);
        if (!agent) {
          await supabase.from("followups").update({ status: "failed", error: "agent config missing" }).eq("id", f.id);
          continue;
        }
        const { data: history } = await supabase
          .from("messages")
          .select("direction, content")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(20);

        const chat = [
          {
            role: "system" as const,
            content:
              agent.systemPrompt +
              "\n\nO cliente não respondeu à última mensagem. Escreva UMA mensagem curta e natural de reengajamento (máx. 2 frases). Não se apresente de novo. Não peça desculpas. Não use emojis em excesso.",
          },
          ...(history || []).reverse().map((m: any) => ({
            role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
            content: m.content,
          })),
          // O follow-up só existe porque a IA falou por último: o histórico acima
          // termina num turno `assistant`. Sem este turno final de `user`, o modelo
          // lê a conversa como encerrada e devolve vazio (finish_reason=stop).
          {
            role: "user" as const,
            content:
              "[sistema] O cliente não respondeu. Escreva agora a mensagem de reengajamento, só ela.",
          },
        ];
        const groq = await callGroq(agent.apiKey, agent.model, chat);
        if (groq.ok && groq.reply && groq.reply.trim()) {
          text = groq.reply.trim();
        } else {
          // Fallback: não perde o follow-up se a Groq falhar/vier vazia
          console.warn("[run-followups] Groq vazio/erro, usando fallback:", groq.error);
          text = "Oi! Só passando pra saber se ainda posso te ajudar com alguma coisa por aqui. 🙂";
        }
      }

      // Envia via Uazapi (prefere config por instância; fallback global)
      const token = inst.instance_token || uaz?.instanceToken;
      const serverUrl = (inst.server_url as string | null)?.replace(/\/$/, "") || uaz?.serverUrl;
      if (!token || !serverUrl) {
        await supabase.from("followups").update({ status: "failed", error: "no uazapi server/token" }).eq("id", f.id);
        continue;
      }
      const sendRes = await fetch(`${serverUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ number: conv.contact_phone, text }),
      });
      if (!sendRes.ok) {
        const errText = await sendRes.text();
        await supabase.from("followups").update({ status: "failed", error: `uazapi ${sendRes.status}: ${errText.slice(0, 300)}` }).eq("id", f.id);
        continue;
      }

      // Persiste mensagem + marca followup enviado
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        user_id: conv.user_id,
        direction: "outbound",
        // Só é "human" quando o texto foi escrito pelo usuário (follow-up manual).
        // Reengajamento automático é da máquina, inclusive o texto de fallback —
        // marcar como "human" fazia o CRM atribuir ao operador algo que ele não digitou.
        sender: f.text_override ? "human" : "ai",
        content: text,
      });
      const newCount =
        f.kind === "auto_inactivity"
          ? (conv.auto_followup_count ?? 0) + 1
          : conv.auto_followup_count ?? 0;
      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          inactivity_followup_at: null,
          auto_followup_count: newCount,
        })
        .eq("id", conv.id);
      await supabase
        .from("followups")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", f.id);

      // Encadeamento: se ainda pode enviar mais um auto, agenda o próximo
      if (f.kind === "auto_inactivity") {
        const { data: agentCfg } = await supabase
          .from("agent_configs")
          .select("followup_inactivity_minutes, followup_max_per_conversation")
          .eq("user_id", conv.user_id)
          .maybeSingle();
        const minutes = agentCfg?.followup_inactivity_minutes ?? 0;
        const max = agentCfg?.followup_max_per_conversation ?? 1;
        if (minutes > 0 && newCount < max) {
          const nextAt = new Date(Date.now() + minutes * 60_000).toISOString();
          await supabase.from("followups").insert({
            user_id: conv.user_id,
            conversation_id: conv.id,
            send_at: nextAt,
            status: "pending",
            kind: "auto_inactivity",
          });
          await supabase
            .from("conversations")
            .update({ inactivity_followup_at: nextAt })
            .eq("id", conv.id);
        }
      }

      processed++;
    } catch (e: any) {
      console.error("[run-followups] error on followup", f.id, e);
      await supabase.from("followups").update({ status: "failed", error: e.message?.slice(0, 300) }).eq("id", f.id);
    }
  }

  return ok({ processed });
});