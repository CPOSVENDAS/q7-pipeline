import type { EnvProblem } from "@/lib/env";

/**
 * Tela mostrada quando as variáveis de ambiente do Supabase estão faltando
 * ou inválidas. Substitui a antiga "tela branca" silenciosa.
 *
 * Usa estilos inline de propósito: precisa renderizar mesmo que o resto do
 * app (tema, providers, Tailwind) não tenha carregado.
 */

const isProd = import.meta.env.PROD;

const s = {
  page: {
    minHeight: "100vh",
    margin: 0,
    padding: "48px 24px",
    background: "#0B1220",
    color: "#E5EAF3",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    lineHeight: 1.6,
    boxSizing: "border-box" as const,
  },
  card: { maxWidth: 720, margin: "0 auto" },
  badge: {
    display: "inline-block",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#FFFFFF",
    background: "#C85A12",
    padding: "4px 10px",
    borderRadius: 999,
  },
  h1: { fontSize: 26, fontWeight: 700, margin: "20px 0 8px" },
  lead: { color: "#94A3B8", margin: "0 0 28px" },
  problem: {
    background: "#151E31",
    border: "1px solid #24314D",
    borderLeft: "3px solid #F87171",
    borderRadius: 8,
    padding: "14px 16px",
    marginBottom: 10,
  },
  varName: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13,
    fontWeight: 700,
    color: "#FCA5A5",
  },
  problemMsg: { margin: "4px 0 0", fontSize: 14, color: "#CBD5E1" },
  h2: { fontSize: 15, fontWeight: 700, margin: "32px 0 10px", color: "#E5EAF3" },
  pre: {
    background: "#0F172A",
    border: "1px solid #24314D",
    borderRadius: 8,
    padding: "14px 16px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13,
    color: "#A5F3D0",
    overflowX: "auto" as const,
    whiteSpace: "pre" as const,
    margin: 0,
  },
  hint: {
    marginTop: 28,
    padding: "14px 16px",
    background: "#0F1B2E",
    border: "1px solid #1E3A5F",
    borderRadius: 8,
    fontSize: 14,
    color: "#BFDBFE",
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 13,
    background: "#1E293B",
    padding: "1px 5px",
    borderRadius: 4,
  },
};

export default function SetupRequired({ problems }: { problems: EnvProblem[] }) {
  return (
    <div style={s.page}>
      <div style={s.card}>
        <span style={s.badge}>Configuração incompleta</span>
        <h1 style={s.h1}>O CPOS Vendas ainda não está conectado ao seu Supabase</h1>
        <p style={s.lead}>
          O app carregou, mas não sabe com qual banco falar. Corrija os itens abaixo
          e ele sobe normalmente.
        </p>

        {problems.map((p) => (
          <div key={p.variable} style={s.problem}>
            <div style={s.varName}>{p.variable}</div>
            <p style={s.problemMsg}>{p.message}</p>
          </div>
        ))}

        {isProd ? (
          <>
            <h2 style={s.h2}>Como corrigir na Vercel</h2>
            <p style={{ ...s.problemMsg, margin: "0 0 10px" }}>
              Settings → Environment Variables → adicione as 3 variáveis abaixo e faça
              um <strong>Redeploy</strong>. Só adicionar não basta: o valor entra no
              build, então precisa reconstruir.
            </p>
            <pre style={s.pre}>{`VITE_SUPABASE_URL=https://SEU-REF.supabase.co
VITE_SUPABASE_PROJECT_ID=SEU-REF
VITE_SUPABASE_PUBLISHABLE_KEY=sua-anon-key`}</pre>
          </>
        ) : (
          <>
            <h2 style={s.h2}>Como corrigir localmente</h2>
            <pre style={s.pre}>{`cp .env.example .env
# preencha o .env com os dados do seu projeto Supabase
npm run dev`}</pre>
            <p style={{ ...s.problemMsg, marginTop: 10 }}>
              Os valores estão no painel do Supabase em{" "}
              <strong>Project Settings → API</strong>. Depois de editar o{" "}
              <code style={s.code}>.env</code>, reinicie o{" "}
              <code style={s.code}>npm run dev</code>.
            </p>
          </>
        )}

        <div style={s.hint}>
          <strong>Travou?</strong> Abra esta pasta no Claude Code e pergunte{" "}
          <em>"como eu instalo isso?"</em> — o arquivo{" "}
          <code style={s.code}>CLAUDE.md</code> tem o passo a passo completo e ele
          consegue executar a instalação para você.
        </div>
      </div>
    </div>
  );
}
