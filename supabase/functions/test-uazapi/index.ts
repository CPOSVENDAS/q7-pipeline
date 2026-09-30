import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Só usuário logado. Esta função faz requisição a uma URL informada pelo chamador,
    // então não pode ficar aberta a quem tem apenas a chave pública do site.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let userId: string | null = null;
    if (jwt && supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: authData } = await sb.auth.getUser(jwt);
      userId = authData?.user?.id ?? null;
    }
    if (!userId) {
      return new Response(
        JSON.stringify({ ok: false, message: "Não autorizado. Faça login novamente." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { serverUrl, instanceToken, adminToken } = await req.json();
    if (!serverUrl) {
      return new Response(
        JSON.stringify({ ok: false, message: "URL do servidor é obrigatória." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const base = String(serverUrl).replace(/\/$/, "");

    // Preferência: testar com Instance Token (endpoint de status da instância)
    if (instanceToken) {
      try {
        const res = await fetch(`${base}/instance/status`, {
          headers: { token: instanceToken },
        });
        const body = await res.text();
        console.log(`[test-uazapi] instance status=${res.status}`);

        if (res.ok) {
          return new Response(
            JSON.stringify({ ok: true, message: "Instance Token válido! Instância respondendo corretamente." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (res.status === 401) {
          return new Response(
            JSON.stringify({ ok: false, message: "Instance Token inválido (401). Copie novamente do painel Uazapi." }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e: any) {
        return new Response(
          JSON.stringify({ ok: false, message: `Não foi possível conectar: ${e?.message || "erro de rede"}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fallback: testar com Admin Token
    if (adminToken) {
      const url = `${base}/instance/all`;
      const attempts = [
        { AdminToken: adminToken },
        { admintoken: adminToken },
      ];

      let lastStatus = 0;
      let lastBody = "";

      for (const headers of attempts) {
        try {
          const res = await fetch(url, { headers });
          lastStatus = res.status;
          lastBody = await res.text();
          console.log(`[test-uazapi] admin header=${Object.keys(headers)[0]} status=${res.status}`);
          if (res.ok) {
            return new Response(
              JSON.stringify({ ok: true, message: "Admin Token válido! Uazapi respondeu corretamente." }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          if (
            res.status === 401 &&
            /public demo server|endpoint has been disabled/i.test(lastBody)
          ) {
            return new Response(
              JSON.stringify({
                ok: true,
                demo: true,
                message:
                  "Servidor demo detectado (free.uazapi.com). O endpoint de validação é bloqueado, mas você pode criar instâncias e conectar o WhatsApp normalmente. Para produção, use um servidor Uazapi próprio.",
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } catch (e: any) {
          console.error("[test-uazapi] fetch error", e?.message);
          return new Response(
            JSON.stringify({ ok: false, message: `Não foi possível conectar: ${e?.message || "erro de rede"}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      let msg = `Uazapi retornou ${lastStatus}. Verifique URL e token.`;
      if (lastStatus === 401) msg = "Admin Token inválido (401). Copie novamente o AdminToken do painel Uazapi.";
      if (lastStatus === 404) msg = "Endpoint não encontrado (404). Confirme a URL do servidor Uazapi.";

      return new Response(
        JSON.stringify({ ok: false, message: msg, details: lastBody?.slice(0, 300) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, message: "Informe pelo menos o Instance Token ou o Admin Token para testar." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, message: error?.message || "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
