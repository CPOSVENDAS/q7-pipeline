import { createClient } from "npm:@supabase/supabase-js@2.49.1";

interface UazapiConfig {
  serverUrl: string;
  adminToken: string | null;
  instanceToken: string | null;
}

let cache: { data: UazapiConfig | null; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getUazapiConfig(): Promise<UazapiConfig | null> {
  if (cache && cache.expires > Date.now()) return cache.data;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let serverUrl: string | null = null;
  let adminToken: string | null = null;
  let instanceToken: string | null = null;

  if (supabaseUrl && serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data } = await admin
        .from("app_settings")
        .select("key,value")
        .in("key", ["uazapi_server_url", "uazapi_admin_token", "uazapi_instance_token"]);

      if (data) {
        for (const row of data) {
          if (row.key === "uazapi_server_url") serverUrl = row.value;
          if (row.key === "uazapi_admin_token") adminToken = row.value;
          if (row.key === "uazapi_instance_token") instanceToken = row.value;
        }
      }
    } catch (e) {
      console.error("[get-uazapi-config] db read failed:", e);
    }
  }

  // Fallback para os secrets antigos (compatibilidade)
  if (!serverUrl) serverUrl = Deno.env.get("OUTREE_UAZAPI_SERVER_URL") ?? null;
  if (!adminToken) adminToken = Deno.env.get("OUTREE_UAZAPI_ADMIN_TOKEN") ?? null;
  if (!instanceToken) instanceToken = Deno.env.get("OUTREE_UAZAPI_INSTANCE_TOKEN") ?? null;

  if (!serverUrl) {
    cache = { data: null, expires: Date.now() + CACHE_TTL_MS };
    return null;
  }

  const config: UazapiConfig = {
    serverUrl: serverUrl.replace(/\/$/, ""),
    adminToken,
    // Instance Token é o padrão; se não existir, fallback para Admin Token
    instanceToken: instanceToken || adminToken,
  };

  cache = { data: config, expires: Date.now() + CACHE_TTL_MS };
  return config;
}
