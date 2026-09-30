import { createClient } from "npm:@supabase/supabase-js@2";
import { callGroq, listChatModels, resolveModelChain } from "../_shared/get-ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Não autorizado" }, 200);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ ok: false, error: "Usuário inválido" }, 200);

    const body = await req.json().catch(() => ({}));
    let { apiKey, model } = body ?? {};

    // A UI limpa o campo da chave depois de salvar, então um teste posterior
    // manda o corpo vazio. Busca o que o usuário salvou antes de desistir.
    const { data: cfg } = await supabase
      .from("agent_configs")
      .select("groq_api_key, groq_model")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!model) model = cfg?.groq_model ?? "auto";
    if (!apiKey) apiKey = cfg?.groq_api_key ?? undefined;

    if (!apiKey) apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) {
      return json({ ok: false, error: "Chave da Groq não configurada. Adicione em Configurações → Integração." }, 200);
    }

    const result = await callGroq(apiKey, model, [
      { role: "system", content: "Responda apenas com a palavra: OK" },
      { role: "user", content: "Teste de conexão" },
    ]);

    if (!result.ok) {
      const tentados = result.tried?.length ? ` (tentados: ${result.tried.join(", ")})` : "";
      return json({ ok: false, error: `${result.error}${tentados}` }, 200);
    }

    // Devolve a lista viva para a UI poder oferecer as opções sem chutar.
    const available = await listChatModels(apiKey);
    const chain = await resolveModelChain(apiKey, model);

    return json({
      ok: true,
      data: {
        reply: String(result.reply).substring(0, 200),
        provider: "groq",
        model: result.model,
        auto: !model || String(model).toLowerCase() === "auto",
        fallbacks: chain.slice(0, 5),
        available,
      },
    }, 200);

  } catch (e: any) {
    return json({ ok: false, error: e.message || "Erro interno" }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
