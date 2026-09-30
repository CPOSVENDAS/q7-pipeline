#!/usr/bin/env node
/**
 * Q7 Pipeline — verificador de instalação.
 *
 *   npm run check                      # usa o .env local
 *   npm run check -- <URL> <ANON_KEY>  # verifica um projeto específico
 *
 * Confere, em ordem: variáveis de ambiente → conexão com a API → as 11 tabelas
 * → as 6 edge functions. Sai com código 1 se algo estiver faltando, então
 * serve tanto para humano quanto para automação.
 *
 * Não precisa de dependências: só Node 18+ (fetch nativo).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`);
const bad = (m) => console.log(`  ${C.red}✗${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

const failures = [];
const warnings = [];
const fail = (m) => { bad(m); failures.push(m); };
const soft = (m) => { warn(m); warnings.push(m); };

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** fetch com timeout — sem isso um host inalcançável trava o script indefinidamente. */
const TIMEOUT_MS = 15000;
function get(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const TABLES = [
  "profiles", "user_roles", "whatsapp_instances", "pipeline_stages",
  "conversations", "messages", "agent_configs", "followups", "app_settings",
  "sale_installments", "commission_actuals",
];

const FUNCTIONS = [
  { name: "whatsapp-webhook", public: true },
  { name: "run-followups", public: true },
  { name: "manage-instance", public: false },
  { name: "test-ai-connection", public: false },
  { name: "test-uazapi", public: false },
  { name: "admin-manage-team", public: false },
];

async function main() {
  console.log(`${C.bold}${C.cyan}Q7 Pipeline — verificação de instalação${C.reset}`);

  // --- 1. Variáveis de ambiente ------------------------------------------
  head("1. Variáveis de ambiente");

  const [argUrl, argKey] = process.argv.slice(2);
  const env = { ...parseEnvFile(resolve(ROOT, ".env")), ...process.env };
  const url = (argUrl || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const key = argKey || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const ref = env.VITE_SUPABASE_PROJECT_ID || "";

  if (!argUrl && !existsSync(resolve(ROOT, ".env"))) {
    fail("Arquivo .env não existe. Rode: cp .env.example .env");
  }
  if (!url) fail("VITE_SUPABASE_URL não definida");
  else if (url.includes("your-project-ref")) fail("VITE_SUPABASE_URL ainda está com o valor de exemplo");
  else if (!/^https:\/\/.+/.test(url)) fail(`VITE_SUPABASE_URL inválida: "${url}"`);
  else ok(`VITE_SUPABASE_URL = ${url}`);

  if (!key) fail("VITE_SUPABASE_PUBLISHABLE_KEY não definida");
  else if (key.includes("your-anon")) fail("VITE_SUPABASE_PUBLISHABLE_KEY ainda está com o valor de exemplo");
  else if (key.startsWith("sb_secret_")) fail("VITE_SUPABASE_PUBLISHABLE_KEY é uma service_role key — NUNCA use no frontend");
  else {
    const parts = key.split(".");
    let role = null;
    if (parts.length === 3) {
      try { role = JSON.parse(Buffer.from(parts[1], "base64url").toString()).role; } catch { /* opaca */ }
    }
    if (role === "service_role") fail("VITE_SUPABASE_PUBLISHABLE_KEY é uma service_role key — NUNCA use no frontend");
    else ok(`VITE_SUPABASE_PUBLISHABLE_KEY = ${key.slice(0, 12)}…`);
  }

  if (!ref) soft("VITE_SUPABASE_PROJECT_ID não definida (opcional, mas o INSTALL pede)");
  else if (ref.includes("your-project-ref")) fail("VITE_SUPABASE_PROJECT_ID ainda está com o valor de exemplo");
  else ok(`VITE_SUPABASE_PROJECT_ID = ${ref}`);

  if (!url || !key || failures.length) return report();

  // --- 2. Conexão ---------------------------------------------------------
  head("2. Conexão com o Supabase");
  try {
    const r = await get(`${url}/rest/v1/`, { headers: { apikey: key } });
    if (r.status === 401) fail("A anon key foi recusada (401). Confira se a chave é deste projeto.");
    else if (!r.ok) fail(`API respondeu ${r.status}. O projeto existe e está ativo?`);
    else ok("API REST respondendo");
  } catch (e) {
    fail(`Não consegui alcançar ${url} — ${e.message}`);
    return report();
  }

  // --- 3. Tabelas ---------------------------------------------------------
  head("3. Schema do banco (11 tabelas)");
  let missing = 0;
  for (const t of TABLES) {
    try {
      const r = await get(`${url}/rest/v1/${t}?select=*&limit=0`, { headers: { apikey: key } });
      if (r.status === 404) { fail(`tabela "${t}" não existe`); missing++; }
      else ok(`tabela "${t}"`);
    } catch (e) {
      fail(`tabela "${t}" — erro de rede: ${e.message}`);
    }
  }
  if (missing) {
    console.log(`\n  ${C.yellow}→ Aplique as 7 migrations, nesta ordem: 20260101000000_q7_init.sql,${C.reset}`);
    console.log(`  ${C.yellow}  20260928120000_reports_and_deal_tracking.sql, 20260929000000_team_and_commission.sql,${C.reset}`);
    console.log(`  ${C.yellow}  20260929120000_installment_due_day.sql, 20260929130000_commission_actuals.sql,${C.reset}`);
    console.log(`  ${C.yellow}  20260929140000_pipeline_stage_funnel.sql, 20260929150000_opening_message_template.sql${C.reset}`);
  }

  // --- 4. Edge Functions --------------------------------------------------
  head("4. Edge Functions (6)");
  for (const fn of FUNCTIONS) {
    try {
      const r = await get(`${url}/functions/v1/${fn.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify({ event: "ping" }),
      });
      if (r.status === 404) fail(`função "${fn.name}" não foi deployada`);
      else if (r.status === 401 && fn.public) {
        fail(`função "${fn.name}" exige JWT — refaça o deploy com --no-verify-jwt`);
      } else ok(`função "${fn.name}" (HTTP ${r.status})`);
    } catch (e) {
      fail(`função "${fn.name}" — erro de rede: ${e.message}`);
    }
  }

  report();
}

function report() {
  console.log("");
  if (failures.length === 0) {
    console.log(`${C.green}${C.bold}✓ Tudo certo.${C.reset} Backend pronto.`);
    if (warnings.length) console.log(`${C.yellow}  ${warnings.length} aviso(s) acima.${C.reset}`);
    console.log(`${C.dim}  Falta o cron dos follow-ups? Confira em: SELECT * FROM cron.job;${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}${C.bold}✗ ${failures.length} problema(s):${C.reset}`);
  failures.forEach((f) => console.log(`   • ${f}`));
  console.log(`\n${C.dim}Abra esta pasta no Claude Code e peça: "conserta o que o npm run check apontou".${C.reset}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`\n${C.red}Erro inesperado:${C.reset}`, e);
  process.exit(1);
});
