/**
 * Chave do webhook, derivada da SERVICE_ROLE_KEY (que nunca sai do servidor).
 * Não exige configurar nada: `manage-instance` a anexa na URL ao registrar o webhook
 * na Uazapi (`?k=...`) e o `whatsapp-webhook` confere quando precisa localizar a
 * instância por nome/telefone — dois dados fáceis de descobrir, ao contrário do token.
 */
export async function webhookKey(): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!secret) return "";
  const data = new TextEncoder().encode(`q7-webhook:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}
