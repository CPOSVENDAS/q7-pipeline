import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { webhookKey } from "../_shared/webhook-key.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, name, phone, instance_token: bodyInstanceToken } = body;

    // Resolve configuração preferencialmente pela instância do usuário
    let baseUrl: string | null = null;
    let instance_token = bodyInstanceToken || null;
    let adminToken: string | null = null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: "Configuração do servidor incompleta." });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Autenticação: só usuário logado. Antes, qualquer um com a chave pública do site
    // conseguia chamar esta função (enviar mensagens, criar/apagar instância global).
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    let callerId: string | null = null;
    if (jwt) {
      const { data: authData } = await admin.auth.getUser(jwt);
      callerId = authData?.user?.id ?? null;
    }
    if (!callerId) {
      return json({ ok: false, error: "Não autorizado. Faça login novamente." });
    }
    const { data: adminRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    // Permitido: dono da instância (token salvo na conta dele) ou admin.
    let allowed = !!adminRole;

    if (instance_token) {
      const { data: instRow } = await admin
        .from("whatsapp_instances")
        .select("server_url, instance_token, user_id")
        .eq("instance_token", instance_token)
        .maybeSingle();
      if (instRow?.user_id === callerId) allowed = true;
      if (instRow?.server_url) {
        baseUrl = instRow.server_url.replace(/\/$/, "");
        instance_token = instRow.instance_token;
      }
    }
    if (!allowed) {
      return json({
        ok: false,
        error: "Sem permissão para esta instância. Salve o Instance Token nas Configurações primeiro.",
      });
    }

    // Fallback para configuração global (admin)
    const globalConfig = await getUazapiConfig();
    if (!baseUrl) {
      if (!globalConfig) {
        console.error("Missing Uazapi config");
        return json({
          ok: false,
          error: "Uazapi não configurado. Configure em Configurações > Uazapi.",
        });
      }
      baseUrl = globalConfig.serverUrl;
      adminToken = globalConfig.adminToken;
      if (!instance_token) instance_token = globalConfig.instanceToken;
    }

    const UAZAPI_ADMIN_TOKEN = adminToken;

    console.log(`[manage-instance] action=${action}, name=${name || ""}, phone=${phone || ""}`);

    if (!action) {
      return json({ ok: false, error: "Ação não informada" });
    }


    // === CREATE (init) ===
    if (action === "create") {
      if (!name) {
        return json({ ok: false, error: "Nome da instância não informado" });
      }


      const uazRes = await fetch(`${baseUrl}/instance/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", AdminToken: UAZAPI_ADMIN_TOKEN },
        body: JSON.stringify({ name }),
      });

      const responseText = await uazRes.text();
      console.log(`[create] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao criar instância", details: responseText });
      }

      const data = JSON.parse(responseText);
      return json({ ok: true, success: true, instance: data });
    }

    // === CONNECT ===
    if (action === "connect") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }


      const connectBody: Record<string, string> = {};
      if (phone) connectBody.phone = phone;

      const uazRes = await fetch(`${baseUrl}/instance/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance_token },
        body: JSON.stringify(connectBody),
      });

      const responseText = await uazRes.text();
      console.log(`[connect] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        // Token inválido/expirado no Uazapi — instância precisa ser recriada
        if (uazRes.status === 401) {
          return json({
            ok: false,
            error:
              "A instância do WhatsApp expirou no servidor. Remova a instância atual e crie uma nova.",
            code: "INSTANCE_TOKEN_INVALID",
            details: responseText,
          });
        }
        return json({ ok: false, error: "Falha ao conectar", details: responseText });
      }

      const data = JSON.parse(responseText);
      const paircode = data.instance?.paircode || data.paircode || null;
      const alreadyConnected = data.connected === true || data.status?.connected === true || data.loggedIn === true;

      return json({ ok: true, success: true, paircode: paircode || null, already_connected: alreadyConnected });
    }

    // === DISCONNECT ===
    if (action === "disconnect") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const uazRes = await fetch(`${baseUrl}/instance/disconnect`, {
        method: "POST",
        headers: { token: instance_token },
      });
      const responseText = await uazRes.text();
      console.log(`[disconnect] status=${uazRes.status}, body=${responseText}`);

      return json({ ok: true, success: true });
    }

    // === DELETE ===
    if (action === "delete") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      try {
        const uazRes = await fetch(`${baseUrl}/instance`, {
          method: "DELETE",
          headers: { token: instance_token },
        });
        const responseText = await uazRes.text();
        console.log(`[delete] status=${uazRes.status}, body=${responseText}`);
      } catch {
        // best effort
      }

      return json({ ok: true, success: true });
    }

    // === STATUS ===
    if (action === "status") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const uazRes = await fetch(`${baseUrl}/instance/status`, {
        method: "GET",
        headers: { token: instance_token },
      });

      const responseText = await uazRes.text();
      console.log(`[status] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao verificar status", details: responseText });
      }

      const data = JSON.parse(responseText);
      
      // Normalize status from various Uazapi response formats
      // data.status can be an object like { connected: true } or a string like "connected"
      const statusObj = data?.status;
      const instanceStatus = data?.instance?.status;
      const isConnected = 
        (typeof statusObj === 'object' && statusObj?.connected === true) ||
        (typeof statusObj === 'string' && (statusObj === "open" || statusObj === "connected" || statusObj === "CONNECTED")) ||
        (typeof instanceStatus === 'string' && (instanceStatus === "open" || instanceStatus === "connected" || instanceStatus === "CONNECTED")) ||
        data?.loggedIn === true ||
        data?.instance?.loggedIn === true;
      
      // O token já identifica a instância: nome, telefone e perfil vêm de graça.
      // Isso dispensa o usuário de digitar o nome à mão.
      const inst = data?.instance ?? {};
      return json({
        ok: true,
        connected: isConnected,
        name: inst.name || data?.name || null,
        phone: inst.owner || data?.owner || null,
        profile_name: inst.profileName || null,
        raw_status: statusObj,
        raw_response: data,
      });
    }

    // === SEND TEXT ===
    if (action === "send_text") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const { number, text, delay: msgDelay, readchat } = body;
      if (!number || !text) {
        return json({ ok: false, error: "Número e texto são obrigatórios" });
      }

      const sendBody: Record<string, any> = { number, text };
      if (msgDelay) sendBody.delay = msgDelay;
      if (readchat !== undefined) sendBody.readchat = readchat;

      const uazRes = await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance_token },
        body: JSON.stringify(sendBody),
      });

      const responseText = await uazRes.text();
      console.log(`[send_text] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao enviar mensagem", details: responseText });
      }

      const data = JSON.parse(responseText);
      return json({ ok: true, success: true, data });
    }

    // === SET WEBHOOK ===
    if (action === "set_webhook") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const { webhook_url } = body;
      if (!webhook_url) {
        return json({ ok: false, error: "URL do webhook não informada" });
      }

      // addUrlEvents PRECISA ser false: com true a Uazapi posta em
      // {url}/messages em vez de {url}, e o webhook nunca recebe nada.
      // Anexa a chave do webhook (`?k=`): o webhook só aceita achar a instância por
      // nome/telefone — dados fáceis de descobrir — quando a chamada traz essa chave.
      let finalWebhookUrl = String(webhook_url);
      try {
        const u = new URL(finalWebhookUrl);
        const k = await webhookKey();
        if (k) u.searchParams.set("k", k);
        finalWebhookUrl = u.toString();
      } catch {
        // URL inválida: segue com o valor original e deixa a Uazapi reclamar
      }

      const webhookBody = {
        enabled: true,
        url: finalWebhookUrl,
        events: ["messages"],
        excludeMessages: ["wasSentByApi"],
        addUrlEvents: false,
      };

      const uazRes = await fetch(`${baseUrl}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token: instance_token },
        body: JSON.stringify(webhookBody),
      });

      const responseText = await uazRes.text();
      console.log(`[set_webhook] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao configurar webhook", details: responseText });
      }

      const data = JSON.parse(responseText);
      return json({ ok: true, success: true, data });
    }

    // === GET WEBHOOKS ===
    if (action === "get_webhooks") {
      if (!instance_token) {
        return json({ ok: false, error: "Token da instância não informado" });
      }

      const uazRes = await fetch(`${baseUrl}/webhook`, {
        method: "GET",
        headers: { Accept: "application/json", token: instance_token },
      });

      const responseText = await uazRes.text();
      console.log(`[get_webhooks] status=${uazRes.status}, body=${responseText}`);

      if (!uazRes.ok) {
        return json({ ok: false, error: "Falha ao buscar webhooks", details: responseText });
      }

      const data = JSON.parse(responseText);
      return json({ ok: true, success: true, webhooks: data });
    }

    return json({ ok: false, error: "Ação inválida" });
  } catch (error) {
    console.error("manage-instance error:", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
});
