# Q7 Pipeline — CRM de WhatsApp com IA

CRM de atendimento por WhatsApp com **IA que responde sozinha**, funil de vendas tipo
Kanban e follow-ups automáticos. Cada instalação é **100% independente**: você conecta
a sua própria infraestrutura (Supabase + Vercel) e as suas próprias credenciais
(Groq + Uazapi). Não depende de nenhuma plataforma proprietária.

---

## Instalação em 1 passo

Abra esta pasta no **[Claude Code](https://claude.com/claude-code)** e pergunte:

```
como eu instalo isso?
```

Ele lê o [CLAUDE.md](CLAUDE.md), pede as credenciais que precisa e **executa a
instalação** — cria as tabelas, sobe as Edge Functions, configura o cron, cria o
repositório no GitHub e te guia até o deploy na Vercel.

Prefere fazer na mão? O passo a passo completo está em **[INSTALL.md](INSTALL.md)**
(~30 min).

---

## O que ele faz

- **Atendimento automático** — cliente manda mensagem no WhatsApp, a IA (Groq /
  Llama 3.3) responde sozinha, com o prompt e o tom que você configurar.
- **Human takeover** — se você responder manualmente, a IA pausa naquela conversa e
  só volta quando você clicar em "Reativar IA".
- **Funil Kanban** — arraste conversas entre estágios (Novo Lead, Em Negociação…).
- **Follow-ups** — mensagens de retomada, manuais ou automáticas em cadeia.
- **Multiusuário com isolamento** — cada usuário só vê os próprios dados (RLS no
  banco). O primeiro cadastro vira admin automaticamente; os demais logins da
  equipe são criados pelo admin na tela **Equipe**.
- **Relatórios** — faturamento, comparativo mês a mês e ano a ano, meta mensal de
  planos e exportação para Excel.
- **Comissão por parcelas** — cada venda tem um checklist de parcelas pagas
  (cliente novo ou reativação); a comissão do mês é calculada por nível de
  vendedor e faixa de adimplência, configurável na tela **Equipe**.

## Stack

| Camada | Tecnologia | Onde roda |
|--------|-----------|-----------|
| Frontend | Vite + React 18 + TypeScript + shadcn/ui + Tailwind | **Vercel** (grátis) |
| Banco + Auth + Realtime | Postgres + Supabase Auth | **Supabase** (grátis) |
| Backend (webhook, cron, testes) | 6 Edge Functions (Deno) | **Supabase** |
| WhatsApp | Uazapi (gateway) | conta própria |
| IA | Groq API (`llama-3.3-70b-versatile`) | conta própria |

> **Importante:** o webhook do WhatsApp roda no **Supabase**, não na Vercel. A Vercel
> serve apenas o site. A Uazapi aponta para
> `https://<seu-ref>.supabase.co/functions/v1/whatsapp-webhook`.

## Contas necessárias (todas com plano grátis)

GitHub · [Supabase](https://supabase.com) · [Vercel](https://vercel.com) ·
[Groq](https://console.groq.com) · [Uazapi](https://uazapi.com)

## Rodar localmente

```bash
npm install
cp .env.example .env    # preencha com os dados do seu projeto Supabase
npm run check           # confere se o backend está pronto
npm run dev             # http://localhost:8080
```

## Documentação

| Arquivo | Para quê |
|---------|----------|
| [CLAUDE.md](CLAUDE.md) | Manual do Claude Code — instalação automatizada e operação |
| [INSTALL.md](INSTALL.md) | Passo a passo manual, do zero à produção |
| [TESTING.md](TESTING.md) | Validação E2E pós-deploy (14 Waves) |

## Segurança

- Nunca faça commit de `.env` nem de `.mcp.json` (ambos já no `.gitignore`).
- As chaves da Groq e da Uazapi **não** ficam no código nem no `.env`: são digitadas
  na interface e guardadas no banco (`agent_configs`, `app_settings`), acessíveis
  apenas ao admin.
- As variáveis `VITE_*` são públicas por natureza (vão para o navegador) — use a
  **anon / publishable key**, nunca a `service_role`. O app recusa subir se detectar
  uma `service_role` key no frontend.
- Este pacote não contém nenhuma credencial, token ou dado do autor original.
