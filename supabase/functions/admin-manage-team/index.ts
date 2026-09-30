import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

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

// Senha temporária só com caracteres fáceis de ler/digitar (sem 0/O/1/l confusos).
function randomPassword(len = 10) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json({ ok: false, error: "Configuração do servidor incompleta." });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Só admin pode chamar esta função — ela cria login novo e reseta senha de terceiros.
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
    if (!adminRole) {
      return json({ ok: false, error: "Só o administrador pode gerenciar a equipe." });
    }

    const body = await req.json();
    const action = body.action || "invite";

    // === Cria o login do vendedor ===
    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.full_name || "").trim();
      const sellerLevel = String(body.seller_level || "Iniciante");
      if (!email || !fullName) {
        return json({ ok: false, error: "Nome e e-mail são obrigatórios." });
      }

      const tempPassword = randomPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true, // já entra confirmado — não depende de e-mail configurado no projeto
        user_metadata: { full_name: fullName },
      });
      if (createErr) {
        const msg = /already.*registered|already exists/i.test(createErr.message || "")
          ? "Já existe uma conta com esse e-mail."
          : createErr.message;
        return json({ ok: false, error: msg });
      }

      const newUserId = created.user?.id;
      // O gatilho on_auth_user_created já criou profile + role 'user' + os 6 estágios
      // padrão do funil sozinho. Só falta gravar o nível escolhido.
      if (newUserId) {
        await admin.from("profiles").update({ seller_level: sellerLevel }).eq("user_id", newUserId);
      }

      return json({
        ok: true,
        user_id: newUserId,
        email,
        temp_password: tempPassword,
        message: "Login criado. Repasse o e-mail e a senha temporária ao vendedor — ele pode trocá-la depois.",
      });
    }

    // === Gera uma nova senha temporária para um login existente ===
    if (action === "reset_password") {
      const userId = String(body.user_id || "");
      if (!userId) return json({ ok: false, error: "Usuário não informado." });

      const tempPassword = randomPassword();
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
      if (updErr) return json({ ok: false, error: updErr.message });

      return json({ ok: true, temp_password: tempPassword });
    }

    return json({ ok: false, error: "Ação inválida." });
  } catch (error) {
    console.error("admin-manage-team error:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Erro desconhecido" });
  }
});
