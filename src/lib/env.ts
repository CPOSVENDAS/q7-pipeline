/**
 * Validação das variáveis de ambiente do frontend.
 *
 * Sem isto, o app quebrava com tela branca quando faltava o `.env` — o
 * `createClient()` lançava "supabaseUrl is required" antes do React montar,
 * e o usuário não via mensagem nenhuma.
 *
 * Aqui a validação acontece ANTES de criar o client, e `main.tsx` usa o
 * resultado para mostrar uma tela de diagnóstico em vez de quebrar.
 */

export interface EnvProblem {
  variable: string;
  message: string;
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Detecta se alguém colou a `service_role` key por engano (nunca pode ir ao navegador). */
function isServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function collectProblems(): EnvProblem[] {
  const problems: EnvProblem[] = [];

  if (!rawUrl || !rawUrl.trim()) {
    problems.push({
      variable: "VITE_SUPABASE_URL",
      message: "Não definida. Deve ser a URL do seu projeto, ex.: https://abcdwxyz1234.supabase.co",
    });
  } else if (rawUrl.includes("your-project-ref")) {
    problems.push({
      variable: "VITE_SUPABASE_URL",
      message: "Ainda está com o valor de exemplo. Troque pela URL do SEU projeto Supabase.",
    });
  } else if (!/^https:\/\//.test(rawUrl.trim())) {
    problems.push({
      variable: "VITE_SUPABASE_URL",
      message: `Valor inválido ("${rawUrl}"). Precisa ser a URL completa começando com https://`,
    });
  } else if (rawUrl.includes("supabase.com/dashboard")) {
    problems.push({
      variable: "VITE_SUPABASE_URL",
      message: "Essa é a URL do painel, não a do projeto. Use a Project URL em Settings → API.",
    });
  }

  if (!rawKey || !rawKey.trim()) {
    problems.push({
      variable: "VITE_SUPABASE_PUBLISHABLE_KEY",
      message: "Não definida. Use a chave anon / publishable em Settings → API.",
    });
  } else if (rawKey.includes("your-anon")) {
    problems.push({
      variable: "VITE_SUPABASE_PUBLISHABLE_KEY",
      message: "Ainda está com o valor de exemplo. Troque pela chave do SEU projeto.",
    });
  } else if (isServiceRoleKey(rawKey)) {
    problems.push({
      variable: "VITE_SUPABASE_PUBLISHABLE_KEY",
      message:
        "PERIGO: essa é a service_role key. Ela dá acesso total ao banco e NUNCA pode ir para o " +
        "navegador. Troque pela anon / publishable key e revogue essa chave no painel.",
    });
  }

  return problems;
}

export const envProblems: EnvProblem[] = collectProblems();
export const isConfigured = envProblems.length === 0;

/** Valores seguros para o client — quando inválidos, o app mostra a tela de setup. */
export const SUPABASE_URL = (rawUrl ?? "https://placeholder.supabase.co").trim();
export const SUPABASE_PUBLISHABLE_KEY = (rawKey ?? "placeholder-key").trim();
