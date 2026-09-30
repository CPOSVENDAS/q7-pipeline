// Traduz mensagens de erro (Supabase, Postgres, Edge Functions, APIs externas) para português.
// Também cobre erros técnicos em inglês que podem vazar da rede/runtime.
const DICT: Array<[RegExp, string]> = [
  // Supabase / Edge Functions
  [/Edge Function returned a non-2xx status code/i,
   "A função de servidor retornou erro. Verifique as configurações de integração."],
  [/Edge function returned a non-2xx status code/i,
   "A função de servidor retornou erro. Verifique as configurações de integração."],
  [/Failed to send a request from the Edge Function/i,
   "A função de servidor não conseguiu se comunicar com uma API externa. Verifique a URL e o token."],
  [/Invalid token/i, "Token inválido. Verifique se copiou o token correto."],
  [/JWT expired/i, "Sua sessão expirou. Faça login novamente."],
  [/JWT token is expired/i, "Sua sessão expirou. Faça login novamente."],
  [/Token has expired/i, "Sua sessão expirou. Faça login novamente."],
  [/Invalid login credentials/i, "E-mail ou senha inválidos."],
  [/User already registered/i, "Este e-mail já está cadastrado."],
  [/Email not confirmed/i, "E-mail ainda não confirmado. Verifique sua caixa de entrada."],
  [/Password should be at least (\d+) characters/i, "A senha precisa ter pelo menos $1 caracteres."],
  [/Password is known to be weak/i, "Esta senha é muito comum. Escolha outra mais forte."],
  [/Signups not allowed/i, "Cadastros estão desativados no momento."],
  [/Email rate limit exceeded/i, "Muitas tentativas. Aguarde alguns minutos e tente novamente."],
  [/new row violates row-level security policy for table "([^"]+)"/i,
   'Sem permissão para gravar na tabela "$1". Faça login com uma conta admin.'],
  [/row-level security policy/i,
   "Sem permissão (política de segurança do banco bloqueou a operação)."],
  [/permission denied for table ([\w.]+)/i,
   'Sem permissão para acessar a tabela "$1".'],
  [/duplicate key value violates unique constraint/i,
   "Já existe um registro com esses dados (valor duplicado)."],
  [/violates foreign key constraint/i,
   "Registro relacionado não encontrado (chave estrangeira inválida)."],
  [/violates not-null constraint.*column "([^"]+)"/i,
   'O campo "$1" é obrigatório.'],
  [/JSON object requested, multiple \(or no\) rows returned/i,
   "Nenhum registro encontrado para essa consulta."],
  [/invalid input syntax/i, "Dado inválido para um dos campos."],

  // Uazapi / WhatsApp
  [/Ua[iz]zapi não configurado/i, "Uazapi não configurado. Acesse Configurações → Integração."],
  [/instanceToken required/i, "Token da instância do WhatsApp é obrigatório."],
  [/instance_token is required/i, "Token da instância do WhatsApp é obrigatório."],
  [/action is required/i, "Ação não informada."],
  [/name is required/i, "Nome não informado."],
  [/Invalid action/i, "Ação inválida."],
  [/Instance not found/i, "Instância do WhatsApp não encontrada."],
  [/No prompt configured/i, "Nenhum prompt configurado para o agente."],
  [/AI not configured/i, "Inteligência artificial não configurada. Acesse Configurações → Integração."],
  [/AI generation failed/i, "A IA falhou ao gerar a resposta. Verifique o prompt e a chave de API."],
  [/Failed to create instance/i, "Falha ao criar instância do WhatsApp."],
  [/Failed to connect/i, "Falha ao conectar ao WhatsApp."],
  [/Failed to send message/i, "Falha ao enviar mensagem pelo WhatsApp."],
  [/Failed to configure webhook/i, "Falha ao configurar webhook."],
  [/Failed to fetch webhooks/i, "Falha ao buscar webhooks."],
  [/INSTANCE_TOKEN_INVALID/i, "A instância do WhatsApp expirou no servidor. Crie uma nova instância."],

  // AI / Provedores
  [/Falha na IA/i, "Falha na inteligência artificial."],
  [/Falha no teste do agente/i, "Falha no teste do agente."],
  [/Falha ao gerar prompt/i, "Falha ao gerar prompt."],
  [/This model.*is no longer available/i,
   "Esse modelo de IA não está mais disponível. Escolha outro modelo em Configurações → Integração."],
  [/This model is currently experiencing high demand/i,
   "O modelo de IA está temporariamente sobrecarregado. Aguarde alguns segundos e tente novamente."],
  [/API key not valid/i, "Chave de API inválida. Verifique a chave em Configurações → Integração."],
  [/API key invalid/i, "Chave de API inválida."],
  [/quota exceeded/i, "Limite de requisições da IA atingido. Aguarde ou troque de provedor."],
  [/rate limit/i, "Limite de requisições atingido. Aguarde um momento."],
  [/model not found/i, "Modelo de IA não encontrado. Verifique o nome do modelo."],
  [/Modelo "([^"]+)" não encontrado/i, 'Modelo "$1" não encontrado. Verifique o nome.'],

  // Rede / Runtime
  [/Failed to fetch/i, "Falha de conexão. Verifique sua internet."],
  [/NetworkError/i, "Erro de rede. Tente novamente."],
  [/Network request failed/i, "Erro de rede. Tente novamente."],
  [/The operation was aborted/i, "A operação foi cancelada (timeout)."],
  [/AbortError/i, "A operação foi cancelada."],
  [/timeout/i, "A operação demorou demais e foi cancelada."],
  [/Fetch failed/i, "Falha na conexão. Verifique sua internet."],
  [/Could not connect/i, "Não foi possível conectar ao servidor."],
  [/Unknown error/i, "Erro desconhecido."],
  [/Unknown/i, "Erro desconhecido."],
  [/undefined is not an object/i, "Erro interno: dado ausente na resposta."],
  [/Cannot read properties of undefined/i, "Erro interno: dado ausente na resposta."],
  [/Unexpected token/i, "Erro interno ao interpretar resposta do servidor."],
];

function extractMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || String(err);
  const anyErr = err as any;
  if (anyErr?.message) return String(anyErr.message);
  if (anyErr?.error_description) return String(anyErr.error_description);
  if (anyErr?.error) {
    if (typeof anyErr.error === "string") return anyErr.error;
    if (anyErr.error?.message) return String(anyErr.error.message);
  }
  if (anyErr?.details) return String(anyErr.details);
  return String(err ?? "Erro desconhecido");
}

export function translateError(err: unknown): string {
  const msg = extractMessage(err);
  for (const [re, pt] of DICT) {
    if (re.test(msg)) return msg.replace(re, pt);
  }
  return msg;
}

export function translateErrorOrDefault(err: unknown, fallback: string): string {
  const translated = translateError(err);
  if (translated && translated !== "Erro desconhecido" && translated !== "undefined") return translated;
  return fallback;
}
