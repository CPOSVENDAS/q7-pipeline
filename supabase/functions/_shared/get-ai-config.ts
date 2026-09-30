import { createClient } from "npm:@supabase/supabase-js@2.49.1";

export interface AIConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
}

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
export const GROQ_DEFAULT_MODEL = "auto";

/**
 * Ordem de preferência para atendimento de WhatsApp: mensagem curta,
 * resposta rápida, maior cota diária primeiro. O 8b tem 14.4k req/dia no
 * free tier contra 1k do 70b — ele aguenta muito mais conversa.
 */
export const MODEL_PREFERENCE = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
  "groq/compound-mini",
];

/** Áudio, TTS, classificadores e guardrails — não respondem chat. */
const NON_CHAT = /whisper|orpheus|prompt-guard|safeguard|allam|tts|guard/i;

/** Status que valem tentar o próximo modelo (o modelo é o problema, não a chave). */
const FAILOVER_STATUS = new Set([400, 404, 413, 422, 429, 500, 502, 503, 504]);

const modelCache = new Map<string, { ids: string[]; at: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getAgentConfig(userId: string): Promise<AIConfig | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  const admin = createClient(supabaseUrl, serviceKey);
  const { data } = await admin
    .from("agent_configs")
    .select("groq_api_key, groq_model, system_prompt, enabled")
    .eq("user_id", userId)
    .maybeSingle();
  const apiKey = data?.groq_api_key || Deno.env.get("GROQ_API_KEY") || null;
  if (!apiKey) return null;
  return {
    apiKey,
    model: data?.groq_model || GROQ_DEFAULT_MODEL,
    systemPrompt:
      data?.system_prompt ||
      "Você é um assistente de atendimento simpático e objetivo. Quando receber [áudio], [imagem], [vídeo] ou [documento], diga que ainda não consegue ouvir ou ver o conteúdo e peça para o cliente resumir por texto.",
    enabled: !!data?.enabled,
  };
}

/**
 * Modelos de chat realmente disponíveis para esta chave, segundo a própria Groq.
 * Cacheado por 10 min para não gastar uma chamada extra a cada mensagem.
 */
export async function listChatModels(apiKey: string): Promise<string[]> {
  const cacheKey = apiKey.slice(-6);
  const hit = modelCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;

  try {
    const res = await fetch(GROQ_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const ids: string[] = (data?.data ?? [])
      .filter((m: any) => m?.active !== false)
      .filter((m: any) => !NON_CHAT.test(String(m?.id ?? "")))
      .filter((m: any) => (m?.context_window ?? 0) >= 8000)
      .map((m: any) => String(m.id));
    if (ids.length) modelCache.set(cacheKey, { ids, at: Date.now() });
    return ids;
  } catch {
    return [];
  }
}

/**
 * Monta a fila de modelos a tentar. Respeita a escolha do usuário quando ela
 * existe e ainda está viva; "auto" (ou modelo decomissionado) cai direto na
 * ordem de preferência filtrada pelo que a Groq diz estar disponível.
 */
export async function resolveModelChain(apiKey: string, preferred?: string): Promise<string[]> {
  const available = await listChatModels(apiKey);
  const wanted = (preferred ?? "").trim();
  const isAuto = !wanted || wanted.toLowerCase() === "auto";

  // Sem lista da Groq (rede caiu, chave sem permissão): usa o palpite estático.
  if (!available.length) {
    return isAuto ? [...MODEL_PREFERENCE] : [wanted, ...MODEL_PREFERENCE.filter((m) => m !== wanted)];
  }

  const chain: string[] = [];
  if (!isAuto && available.includes(wanted)) chain.push(wanted);
  for (const m of MODEL_PREFERENCE) {
    if (available.includes(m) && !chain.includes(m)) chain.push(m);
  }
  // Nenhum preferido sobreviveu — aceita qualquer chat model que a conta tenha.
  for (const m of available) {
    if (!chain.includes(m)) chain.push(m);
  }
  return chain;
}

export interface GroqResult {
  ok: boolean;
  reply?: string;
  model?: string;
  error?: string;
  status?: number;
  tried?: string[];
}

/** Uma tentativa, um modelo. Sem fallback. */
export async function callGroqOnce(
  apiKey: string,
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<GroqResult> {
  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, model, status: res.status, error: translateAIError(text, res.status) };
    }
    const data = JSON.parse(text);
    const reply = data.choices?.[0]?.message?.content;
    if (!reply || !String(reply).trim()) {
      const finish = data.choices?.[0]?.finish_reason;
      return { ok: false, model, error: `Resposta vazia da IA (finish_reason=${finish ?? "n/a"})` };
    }
    return { ok: true, model, reply: String(reply) };
  } catch (e: any) {
    return { ok: false, model, error: e.message || "Falha ao chamar IA" };
  }
}

/**
 * Chama a Groq com failover automático de modelo.
 *
 * Passa `model = "auto"` (ou vazio) para deixar o sistema escolher. Se o modelo
 * escolhido estiver sobrecarregado (503), estourou cota (429) ou foi
 * decomissionado (404), tenta o próximo da fila em vez de devolver erro ao
 * cliente. Chave inválida (401/403) NÃO faz failover — trocar de modelo não
 * conserta chave errada.
 */
export async function callGroq(
  apiKey: string,
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<GroqResult> {
  const chain = await resolveModelChain(apiKey, model);
  const tried: string[] = [];
  let last: GroqResult = { ok: false, error: "Nenhum modelo Groq disponível para esta chave." };

  for (const candidate of chain) {
    tried.push(candidate);
    const result = await callGroqOnce(apiKey, candidate, messages);
    if (result.ok) return { ...result, tried };
    last = result;

    // Chave inválida: nenhum outro modelo vai funcionar. Para agora.
    if (result.status === 401 || result.status === 403) break;
    // Erro que não é do modelo (rede, parse): também não adianta cascatear.
    if (result.status !== undefined && !FAILOVER_STATUS.has(result.status)) break;
    if (result.status === undefined) break;

    // Modelo sumiu da conta — invalida o cache para a próxima chamada.
    if (result.status === 404) modelCache.delete(apiKey.slice(-6));
  }

  return { ...last, tried };
}

export function translateAIError(text: string, status: number): string {
  const t = text.substring(0, 500);
  if (status === 503 || /overloaded|high demand|service unavailable/i.test(t)) {
    return "O modelo Groq está temporariamente sobrecarregado. Aguarde alguns segundos e tente novamente.";
  }
  if (status === 429 || /rate limit|too many requests/i.test(t)) {
    return "Limite de requisições da Groq atingido. Aguarde um momento.";
  }
  if (status === 401 || status === 403 || /invalid api key|invalid_api_key/i.test(t)) {
    return "Chave da Groq inválida. Verifique em Configurações → Integração.";
  }
  if (status === 404 || /model.*not found|does not exist|decommissioned/i.test(t)) {
    return "Modelo Groq não encontrado. Escolha outro em Configurações → Integração.";
  }
  if (status === 400 || /bad request|invalid request/i.test(t)) {
    return "Requisição inválida para a Groq. Verifique o modelo e a chave.";
  }
  return `A Groq retornou erro ${status}: ${t}`;
}
