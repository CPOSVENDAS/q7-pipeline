import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Cria o registro da transmissão + a fila de destinatários (um por contato da
// coluna escolhida). NÃO manda nada daqui — quem manda, aos poucos e com
// espaçamento entre contatos, é a função `run-broadcasts` (cron, a cada
// minuto). Isso evita travar essa chamada por minutos num Kanban grande e,
// principalmente, evita rajada de mensagens que derruba o número no WhatsApp.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: "Configuração do servidor incompleta." });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    let userId: string | null = null;
    if (jwt) {
      const { data: authData } = await admin.auth.getUser(jwt);
      userId = authData?.user?.id ?? null;
    }
    if (!userId) {
      return json({ ok: false, error: "Não autorizado. Faça login novamente." });
    }

    const body = await req.json().catch(() => ({}));
    const stageId: string = String(body?.stageId || "").trim();
    const caption: string | null = body?.caption ? String(body.caption).trim() : null;
    const imageUrl: string | null = body?.imageUrl ? String(body.imageUrl).trim() : null;
    const audioUrl: string | null = body?.audioUrl ? String(body.audioUrl).trim() : null;

    if (!stageId) return json({ ok: false, error: "Escolha uma coluna do Kanban." });
    if (!caption && !imageUrl && !audioUrl) {
      return json({ ok: false, error: "Mande pelo menos uma foto, um áudio ou um texto." });
    }

    const { data: stage, error: stageErr } = await admin
      .from("pipeline_stages")
      .select("id, name")
      .eq("id", stageId)
      .eq("user_id", userId)
      .maybeSingle();
    if (stageErr || !stage) {
      return json({ ok: false, error: "Coluna não encontrada." });
    }

    const { data: contacts, error: contactsErr } = await admin
      .from("conversations")
      .select("id, contact_phone")
      .eq("user_id", userId)
      .eq("stage_id", stageId);
    if (contactsErr) {
      return json({ ok: false, error: contactsErr.message });
    }
    if (!contacts?.length) {
      return json({ ok: false, error: `Não há nenhum contato na coluna "${stage.name}".` });
    }

    const { data: broadcast, error: insertErr } = await admin
      .from("broadcasts")
      .insert({
        user_id: userId,
        stage_id: stage.id,
        stage_name: stage.name,
        caption,
        image_url: imageUrl,
        audio_url: audioUrl,
        total_count: contacts.length,
        status: "pending",
      })
      .select("id")
      .single();
    if (insertErr || !broadcast) {
      return json({ ok: false, error: insertErr?.message || "Falha ao criar a transmissão." });
    }

    const recipients = contacts.map((c) => ({
      broadcast_id: broadcast.id,
      conversation_id: c.id,
      user_id: userId,
      phone: c.contact_phone,
      status: "pending",
    }));
    const { error: recipientsErr } = await admin.from("broadcast_recipients").insert(recipients);
    if (recipientsErr) {
      await admin.from("broadcasts").update({ status: "failed" }).eq("id", broadcast.id);
      return json({ ok: false, error: recipientsErr.message });
    }

    return json({ ok: true, broadcastId: broadcast.id, total: contacts.length });
  } catch (e: any) {
    console.error("[send-broadcast] error", e);
    return json({ ok: false, error: e.message });
  }
});
