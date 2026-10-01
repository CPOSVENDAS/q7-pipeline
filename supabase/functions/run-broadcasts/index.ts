import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";

// Poucos por vez e com espera entre cada um — a Uazapi é WhatsApp NÃO-oficial
// (número normal, ligado por QR Code), e mandar a mesma mídia muito rápido
// pra vários números seguidos é a principal causa de ban. É melhor uma lista
// grande demorar alguns minutos (processada aos poucos, a cada vez que o cron
// roda, 1x por minuto) do que arriscar o número do cliente.
const BATCH = 5;
const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 9000;

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

async function refreshBroadcastStatus(admin: any, broadcastId: string) {
  const { data: b } = await admin
    .from("broadcasts")
    .select("total_count, sent_count, failed_count")
    .eq("id", broadcastId)
    .maybeSingle();
  if (!b) return;
  const done = (b.sent_count ?? 0) + (b.failed_count ?? 0);
  let status = "running";
  if (done >= b.total_count) {
    status = (b.failed_count ?? 0) > 0 ? "completed_with_errors" : "completed";
  }
  await admin.from("broadcasts").update({ status }).eq("id", broadcastId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Destrava itens presos em "sending" há mais de 10 min (execução anterior
  // interrompida no meio) — mesmo princípio do run-followups.
  await supabase
    .from("broadcast_recipients")
    .update({ status: "pending" })
    .eq("status", "sending")
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const { data: due, error } = await supabase
    .from("broadcast_recipients")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) return ok({ ok: false, error: error.message });
  if (!due?.length) return ok({ processed: 0 });

  const uaz = await getUazapiConfig(); // fallback global, se a instância não tiver token próprio

  let processed = 0;
  for (let i = 0; i < due.length; i++) {
    const r = due[i];
    try {
      const { data: claimed } = await supabase
        .from("broadcast_recipients")
        .update({ status: "sending" })
        .eq("id", r.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed?.length) continue;

      const { data: broadcast } = await supabase
        .from("broadcasts")
        .select("*")
        .eq("id", r.broadcast_id)
        .maybeSingle();
      if (!broadcast) {
        await supabase.from("broadcast_recipients").update({ status: "failed", error: "transmissão não encontrada" }).eq("id", r.id);
        continue;
      }

      const { data: conv } = await supabase
        .from("conversations")
        .select("id, instance_id")
        .eq("id", r.conversation_id)
        .maybeSingle();

      let serverUrl: string | null = null;
      let token: string | null = null;
      if (conv?.instance_id) {
        const { data: inst } = await supabase
          .from("whatsapp_instances")
          .select("instance_token, server_url")
          .eq("id", conv.instance_id)
          .maybeSingle();
        serverUrl = (inst?.server_url as string | null)?.replace(/\/$/, "") ?? null;
        token = inst?.instance_token ?? null;
      }
      if (!serverUrl) serverUrl = uaz?.serverUrl ?? null;
      if (!token) token = uaz?.instanceToken ?? null;

      if (!serverUrl || !token) {
        await supabase.from("broadcast_recipients").update({ status: "failed", error: "sem server/token da Uazapi" }).eq("id", r.id);
        await supabase.from("broadcasts").update({ failed_count: (broadcast.failed_count ?? 0) + 1 }).eq("id", broadcast.id);
        await refreshBroadcastStatus(supabase, broadcast.id);
        continue;
      }

      const sentParts: string[] = [];
      let failReason: string | null = null;

      if (broadcast.image_url) {
        const res = await fetch(`${serverUrl}/send/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify({
            number: r.phone,
            type: "image",
            file: broadcast.image_url,
            ...(broadcast.caption ? { text: broadcast.caption } : {}),
          }),
        });
        if (res.ok) sentParts.push("[imagem]");
        else failReason = `imagem: ${(await res.text()).slice(0, 200)}`;
      }

      if (!failReason && broadcast.audio_url) {
        if (broadcast.image_url) await sleep(1200); // não manda os dois colados
        const res = await fetch(`${serverUrl}/send/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify({ number: r.phone, type: "ptt", file: broadcast.audio_url }),
        });
        if (res.ok) sentParts.push("[áudio]");
        else failReason = `áudio: ${(await res.text()).slice(0, 200)}`;
      }

      if (!failReason && !broadcast.image_url && !broadcast.audio_url && broadcast.caption) {
        const res = await fetch(`${serverUrl}/send/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify({ number: r.phone, text: broadcast.caption }),
        });
        if (res.ok) sentParts.push(broadcast.caption);
        else failReason = `texto: ${(await res.text()).slice(0, 200)}`;
      }

      if (failReason) {
        await supabase.from("broadcast_recipients").update({ status: "failed", error: failReason }).eq("id", r.id);
        await supabase.from("broadcasts").update({ failed_count: (broadcast.failed_count ?? 0) + 1 }).eq("id", broadcast.id);
      } else {
        await supabase
          .from("broadcast_recipients")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", r.id);
        await supabase.from("broadcasts").update({ sent_count: (broadcast.sent_count ?? 0) + 1 }).eq("id", broadcast.id);

        // Registra no histórico da conversa, igual uma mensagem manual do operador.
        const label = sentParts.filter((p) => p.startsWith("[")).join(" ");
        const content = [label, broadcast.caption && !label.includes(broadcast.caption) ? broadcast.caption : null]
          .filter(Boolean)
          .join(" ") || "[transmissão]";
        await supabase.from("messages").insert({
          conversation_id: r.conversation_id,
          user_id: r.user_id,
          direction: "outbound",
          sender: "human",
          content,
        });
        await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", r.conversation_id);
      }

      await refreshBroadcastStatus(supabase, broadcast.id);
      processed++;
    } catch (e: any) {
      console.error("[run-broadcasts] error on recipient", r.id, e);
      await supabase.from("broadcast_recipients").update({ status: "failed", error: e.message?.slice(0, 300) }).eq("id", r.id);
    }

    if (i < due.length - 1) await sleep(randomDelay());
  }

  return ok({ processed });
});
