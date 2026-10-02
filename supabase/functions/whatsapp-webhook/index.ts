import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentConfig, callGroq } from "../_shared/get-ai-config.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { cancelPendingFollowups, scheduleInactivityFollowup } from "../_shared/followups.ts";
import { webhookKey } from "../_shared/webhook-key.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, token",
};

function normalizeName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function ok(body: any = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Converte JID do WhatsApp em telefone. Retorna "" quando o JID não é um número (@g.us, @lid). */
function jidToPhone(jid: string | null | undefined) {
  const raw = String(jid || "");
  if (!raw) return "";
  if (raw.includes("@g.us") || raw.includes("@lid")) return "";
  return raw.replace(/@.*/, "").replace(/:.*/, "").replace(/\D/g, "");
}

/** O campo `content` da Uazapi chega como string JSON (ex: '{"text":"oi"}') em vários tipos. */
function readContent(content: any): string | null {
  if (!content) return null;
  if (typeof content === "object") return content.text ?? null;
  const s = String(content).trim();
  if (!s.startsWith("{")) return s || null;
  try {
    return JSON.parse(s)?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Mídia sem legenda chega sem texto nenhum (áudio, foto pura, figurinha). Sem um marcador
 * essas mensagens caíam na guarda de "sem_texto" e o lead que só manda áudio — o padrão no
 * Brasil — nunca virava card nem recebia resposta.
 */
function mediaLabel(m: any): string | null {
  const t = String(m?.messageType || m?.mediaType || m?.type || "").toLowerCase();
  if (!t) return null;
  if (t.includes("audio") || t.includes("ptt")) return "[áudio]";
  if (t.includes("image")) return "[imagem]";
  if (t.includes("video")) return "[vídeo]";
  if (t.includes("sticker")) return "[figurinha]";
  if (t.includes("document")) return "[documento]";
  if (t.includes("location")) return "[localização]";
  if (t.includes("contact") || t.includes("vcard")) return "[contato]";
  return null;
}

function extractText(body: any) {
  // Uazapi atual: { EventType, message: {campos planos}, chat: {...}, owner, token }
  // Legado/Baileys: { data: { message: { conversation }, key: { remoteJid, fromMe } } }
  const envelope = body.data || body;
  const m = envelope?.message ?? body.message ?? envelope ?? {};
  const chat = body.chat || envelope?.chat || {};

  const media = mediaLabel(m);
  const text =
    m?.text ||                                  // Uazapi: campo canônico
    readContent(m?.content) ||                  // Uazapi: content como JSON string
    m?.message?.conversation ||                 // Baileys puro
    m?.message?.extendedTextMessage?.text ||
    m?.body ||
    media ||                                    // mídia sem legenda → "[áudio]", "[imagem]"...
    null;

  const fromMe = m?.fromMe ?? m?.key?.fromMe ?? false;
  const rawJid = m?.chatid || m?.key?.remoteJid || chat?.wa_chatid || m?.from || "";
  const isGroup =
    m?.isGroup === true || chat?.wa_isGroup === true || String(rawJid).includes("@g.us");

  // chatid pode vir como @lid (id opaco). Os campos do `chat` sempre apontam para o
  // contato; `sender_pn` aponta para quem enviou — em mensagem nossa (fromMe) esse é
  // o dono da instância, então só serve como fallback quando a mensagem é do contato.
  const phone =
    jidToPhone(rawJid) ||
    jidToPhone(chat?.wa_chatid) ||
    jidToPhone(chat?.lead_phone) ||
    jidToPhone(chat?.phone) ||
    (fromMe ? "" : jidToPhone(m?.sender_pn)) ||
    "";

  // `senderName`/`pushName` descrevem quem ENVIOU: em mensagem nossa (fromMe) são o dono
  // da instância, então usá-los renomeia o lead com o nome do operador a cada resposta.
  const contactName = fromMe
    ? chat?.lead_name || chat?.wa_name || null
    : m?.senderName || chat?.lead_name || chat?.wa_name || m?.pushName || null;
  const instanceName = body.instance?.name || body.instanceName || "";
  const instanceToken = body.token || body.instance?.token || m?.token || null;
  // `owner` é o telefone da instância: último recurso pra achar o dono sem token nem nome
  const instanceOwner = jidToPhone(body.owner || m?.owner || chat?.owner);

  return { text, media, fromMe, phone, isGroup, contactName, instanceName, instanceToken, instanceOwner, message: m };
}

/**
 * Acha a linha de `whatsapp_instances` dona do evento. Mesma regra usada no
 * fluxo de mensagens: o token já identifica a instância sozinho; nome e
 * telefone (fáceis de descobrir) só valem como fallback quando a chamada
 * trouxe a chave (`?k=`) que o `manage-instance` anexa ao registrar o
 * webhook — sem isso, qualquer um poderia forjar eventos para uma instância
 * que não é dele.
 */
async function resolveInstance(
  supabase: ReturnType<typeof createClient>,
  keyOk: boolean,
  info: { instanceToken: string | null; instanceName: string; instanceOwner: string },
): Promise<any> {
  const { instanceToken, instanceName, instanceOwner } = info;
  let instRow: any = null;
  if (instanceToken) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("instance_token", instanceToken)
      .maybeSingle();
    instRow = data;
  }
  if (!instRow && !keyOk && (instanceName || instanceOwner)) {
    console.warn("[webhook] fallback por nome/telefone ignorado: chamada sem chave válida", {
      instanceName,
      hasToken: !!instanceToken,
    });
  }
  if (!instRow && keyOk && instanceName) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("name", instanceName)
      .maybeSingle();
    instRow = data;
  }
  if (!instRow && keyOk && instanceName) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .not("instance_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(20);
    instRow = (data || []).find((row: any) => normalizeName(row.name) === normalizeName(instanceName)) || null;
  }
  // Último recurso: o telefone da instância (`owner`) vem em todo payload da Uazapi
  if (!instRow && keyOk && instanceOwner) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("phone", instanceOwner)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    instRow = data;
  }
  return instRow;
}

/**
 * Evento `connection` da Uazapi: a sessão do WhatsApp caiu ou voltou. Antes
 * esse evento chegava e era descartado sem nenhum tratamento — o painel só
 * descobria a queda quando alguém clicava em "Conectar" de novo, e a IA
 * ficava tentando responder em silêncio até lá. Agora gravamos a mudança na
 * hora em `whatsapp_instances`; o front-end escuta essa tabela via Realtime
 * e avisa o vendedor assim que a sessão cai.
 */
async function handleConnectionEvent(body: any, req: Request) {
  const instanceName = body.instance?.name || body.instanceName || "";
  const instanceToken = body.token || body.instance?.token || null;
  const instanceOwner = jidToPhone(body.owner || body.instance?.owner);

  // Mesma normalização usada em manage-instance (ação "status"): a Uazapi
  // descreve o status ora como objeto ({connected:true}), ora como string
  // ("open"/"connected"/"close"), ora como booleano solto.
  const statusVal = body.status ?? body.instance?.status ?? body.state ?? body.connection;
  const isConnected =
    (typeof statusVal === "object" && statusVal !== null && (statusVal as any)?.connected === true) ||
    (typeof statusVal === "string" && ["open", "connected", "CONNECTED"].includes(statusVal)) ||
    body.loggedIn === true ||
    body.instance?.loggedIn === true;

  console.log("[webhook] connection event", {
    instanceName,
    hasToken: !!instanceToken,
    status: typeof statusVal === "string" ? statusVal : JSON.stringify(statusVal),
    isConnected,
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const expectedKey = await webhookKey();
  const keyOk = !!expectedKey && new URL(req.url).searchParams.get("k") === expectedKey;
  const instRow = await resolveInstance(supabase, keyOk, { instanceToken, instanceName, instanceOwner });
  if (!instRow) {
    console.warn("[webhook] connection event: instancia nao encontrada", { instanceName, hasToken: !!instanceToken });
    return ok();
  }

  const update: Record<string, any> = { status: isConnected ? "connected" : "disconnected" };
  if (!isConnected) update.last_disconnected_at = new Date().toISOString();
  await supabase.from("whatsapp_instances").update(update).eq("id", instRow.id);
  console.log("[webhook] connection event aplicado", { id: instRow.id, name: instRow.name, status: update.status });

  return ok();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const event = body.EventType || body.event || body.type || "messages";
    if (event === "test") return ok({ ok: true, message: "webhook ok" });
    if (event === "dry_run") return await runDryRun(body);
    if (event === "connection" || event === "connection.update") return await handleConnectionEvent(body, req);

    const { text, media, fromMe, phone, isGroup, contactName, instanceName, instanceToken, instanceOwner } =
      extractText(body);

    // Observabilidade: sem isso, mudança no payload da Uazapi vira descarte silencioso.
    console.log("[webhook] in", {
      event,
      body_keys: Object.keys(body || {}).join(","),
      has_text: !!text,
      media: media || null,
      phone: phone || null,
      is_group: isGroup,
      from_me: fromMe,
      has_token: !!instanceToken,
      owner: instanceOwner || null,
    });

    if (isGroup || !text || !phone) {
      console.log("[webhook] ignorado", {
        reason: isGroup ? "grupo" : !text ? "sem_texto" : "sem_telefone",
      });
      return ok();
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find instance by token or name → resolves owner
    // O token é segredo de quem é dono da instância. Já nome e telefone são fáceis de
    // descobrir: por isso só valem como fallback quando a chamada traz a chave (`?k=`)
    // que o `manage-instance` anexa à URL ao registrar o webhook. Sem ela, qualquer
    // pessoa poderia forjar mensagens e fazer a IA responder a números escolhidos por ela.
    const expectedKey = await webhookKey();
    const keyOk = !!expectedKey && new URL(req.url).searchParams.get("k") === expectedKey;
    const instRow = await resolveInstance(supabase, keyOk, { instanceToken, instanceName, instanceOwner });
    if (!instRow) {
      console.warn("[webhook] instance not found", {
        instanceName,
        hasToken: !!instanceToken,
        owner: instanceOwner,
      });
      return ok();
    }
    console.log("[webhook] instancia resolvida", { id: instRow.id, name: instRow.name });

    const userId = instRow.user_id;

    // Auto-sincroniza o nome salvo com o nome real vindo da Uazapi (matches por token)
    if (instanceName && instRow.name !== instanceName) {
      await supabase
        .from("whatsapp_instances")
        .update({ name: instanceName })
        .eq("id", instRow.id);
      instRow.name = instanceName;
    }

    // Upsert conversation
    const { data: convExisting } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", userId)
      .eq("contact_phone", phone)
      .maybeSingle();

    let conv = convExisting;
    if (!conv) {
      // Novo contato → coluna "Novo Lead" (fallback: primeiro stage por position)
      const { data: novoLead } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("user_id", userId)
        .eq("name", "Novo Lead")
        .limit(1)
        .maybeSingle();
      let firstStage = novoLead;
      if (!firstStage) {
        const { data: fallback } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("user_id", userId)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstStage = fallback;
      }
      // Conta criada antes do seed automático → sem kanban, o lead ficaria invisível.
      // Cria as colunas padrão na hora em vez de gravar stage_id nulo.
      if (!firstStage) {
        console.log("[webhook] kanban vazio, criando etapas padrao", { userId });
        await supabase.from("pipeline_stages").insert([
          { user_id: userId, name: "Novo Lead", position: 0, color: "#3FB8BE" },
          { user_id: userId, name: "Em Negociação", position: 1, color: "#F59E0B" },
          { user_id: userId, name: "Fechado", position: 2, color: "#10B981" },
        ]);
        const { data: seeded } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("user_id", userId)
          .order("position", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstStage = seeded;
      }
      const { data: created, error: createErr } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          instance_id: instRow.id,
          contact_phone: phone,
          contact_name: contactName,
          ai_enabled: fromMe ? false : true,
          human_takeover_at: fromMe ? new Date().toISOString() : null,
          last_message_at: new Date().toISOString(),
          stage_id: firstStage?.id ?? null,
        })
        .select()
        .single();
      // Contato novo mandando duas mensagens juntas: as duas passam pelo select acima sem
      // achar conversa e as duas tentam inserir. O índice único (user_id, contact_phone)
      // barra a segunda — sem reler aqui, essa mensagem sumiria sem deixar rastro.
      if (createErr) {
        console.log("[webhook] corrida na criacao, relendo conversa", { phone });
        const { data: raced } = await supabase
          .from("conversations")
          .select("*")
          .eq("user_id", userId)
          .eq("contact_phone", phone)
          .maybeSingle();
        conv = raced;
      } else {
        conv = created;
      }
    } else {
      const update: Record<string, any> = {
        last_message_at: new Date().toISOString(),
        contact_name: contactName || conv.contact_name,
      };
      if (fromMe) {
        update.ai_enabled = false;
        update.human_takeover_at = new Date().toISOString();
        conv.ai_enabled = false;
        conv.human_takeover_at = update.human_takeover_at;
      }
      await supabase.from("conversations").update(update).eq("id", conv.id);
    }
    if (!conv) return ok();

    // Mensagem enviada do próprio celular do usuário → registra como takeover humano
    // e encerra aqui (não chama IA, não reenvia via Uazapi).
    if (fromMe) {
      console.log("[webhook] takeover humano", { phone, conversa: conv.id, ia: "desligada" });
      await cancelPendingFollowups(supabase, conv.id);
      await supabase
        .from("conversations")
        .update({ inactivity_followup_at: null, auto_followup_count: 0 })
        .eq("id", conv.id);
      await supabase.from("messages").insert({
        conversation_id: conv.id,
        user_id: userId,
        direction: "outbound",
        sender: "human",
        content: text,
      });
      return ok();
    }

    // Cliente respondeu → cancela follow-ups pendentes e zera contador de auto-follow-ups
    await cancelPendingFollowups(supabase, conv.id);
    await supabase
      .from("conversations")
      .update({ inactivity_followup_at: null, auto_followup_count: 0 })
      .eq("id", conv.id);

    // Save inbound message
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      user_id: userId,
      direction: "inbound",
      sender: "contact",
      content: text,
    });

    // AI reply?
    if (!conv.ai_enabled) return ok();
    const agent = await getAgentConfig(userId);
    if (!agent || !agent.enabled) return ok();

    // Build history (last 20 messages)
    const { data: history } = await supabase
      .from("messages")
      .select("direction, sender, content")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const chat = [
      { role: "system" as const, content: agent.systemPrompt },
      ...(history || []).reverse().map((m: any) => ({
        role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      })),
    ];

    const groq = await callGroq(agent.apiKey, agent.model, chat);
    if (!groq.ok || !groq.reply) {
      console.error("[webhook] groq failed", groq.error);
      return ok();
    }

    // Send via Uazapi (prefere config por instância; fallback global)
    const uaz = await getUazapiConfig();
    const serverUrl = (instRow.server_url as string | null)?.replace(/\/$/, "") || uaz?.serverUrl;
    const token = instRow.instance_token || uaz?.instanceToken;
    if (!serverUrl || !token) {
      console.error("[webhook] uazapi server/token missing", { hasServer: !!serverUrl, hasToken: !!token });
      return ok();
    }
    const sendRes = await fetch(`${serverUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: phone, text: groq.reply }),
    });
    if (!sendRes.ok) {
      console.error("[webhook] uazapi send failed", await sendRes.text());
      return ok();
    }

    // Persist outbound
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      user_id: userId,
      direction: "outbound",
      sender: "ai",
      content: groq.reply,
    });
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    // Agenda auto-follow-up por inatividade, se habilitado
    await scheduleInactivityFollowup({
      admin: supabase,
      userId,
      conversationId: conv.id,
      currentAutoCount: conv.auto_followup_count ?? 0,
    });

    return ok();
  } catch (e: any) {
    console.error("[webhook] error", e);
    return ok({ ok: false, error: e.message });
  }
});

async function runDryRun(body: any) {
  const inName: string = String(body?.instance?.name || "").trim();
  const inToken: string = String(body?.instance?.token || "").trim();
  const checks: any = {
    instance: { ok: false, matched_by: null, name_mismatch: false, instance_name: null },
    agent: { ok: false, has_key: false, enabled: false },
    groq: { ok: false },
    uazapi: { ok: false },
  };

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Instance lookup
  let instRow: any = null;
  if (inToken) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("instance_token", inToken)
      .maybeSingle();
    if (data) {
      instRow = data;
      checks.instance.matched_by = "token";
    }
  }
  if (!instRow && inName) {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .not("instance_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(20);
    instRow = (data || []).find((r: any) => normalizeName(r.name) === normalizeName(inName)) || null;
    if (instRow) checks.instance.matched_by = "name";
  }
  if (instRow) {
    checks.instance.ok = true;
    checks.instance.instance_name = instRow.name;
    checks.instance.name_mismatch = !!(inName && instRow.name !== inName);
  } else {
    checks.instance.error = "Nenhuma instância encontrada com esse token/nome";
    return ok({ ok: false, checks });
  }

  // 2. Agent
  const agent = await getAgentConfig(instRow.user_id);
  checks.agent.has_key = !!agent?.apiKey;
  checks.agent.enabled = !!agent?.enabled;
  checks.agent.ok = checks.agent.has_key && checks.agent.enabled;
  if (!checks.agent.has_key) checks.agent.error = "Chave da Groq não configurada";
  else if (!checks.agent.enabled) checks.agent.error = "Agente não está ativo";

  // 3. Groq ping
  if (agent?.apiKey) {
    const r = await callGroq(agent.apiKey, agent.model, [
      { role: "system", content: "Responda apenas: ok" },
      { role: "user", content: "ping" },
    ]);
    checks.groq.ok = r.ok;
    if (!r.ok) checks.groq.error = r.error;
  } else {
    checks.groq.error = "Sem chave para testar";
  }

  // 4. Uazapi reachable
  const uaz = await getUazapiConfig();
  const serverUrl = (instRow.server_url as string | null)?.replace(/\/$/, "") || uaz?.serverUrl;
  const token = instRow.instance_token || uaz?.instanceToken;
  if (!serverUrl || !token) {
    checks.uazapi.error = "Server URL ou token da instância ausente";
  } else {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${serverUrl}/instance/status`, {
        method: "GET",
        headers: { token },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      await res.text().catch(() => "");
      checks.uazapi.ok = res.ok;
      checks.uazapi.status = res.status;
      if (!res.ok) checks.uazapi.error = `Uazapi retornou HTTP ${res.status}`;
    } catch (e: any) {
      checks.uazapi.error = e?.message || "Falha ao conectar na Uazapi";
    }
  }

  const allOk = checks.instance.ok && checks.agent.ok && checks.groq.ok && checks.uazapi.ok;
  return ok({ ok: allOk, checks });
}