# INSTALL.md — Instalação manual do Q7 Pipeline

Do repositório clonado até o WhatsApp respondendo sozinho, usando **a sua própria
infraestrutura**. Tempo estimado: **30–45 min**.

> **Atalho:** abra esta pasta no [Claude Code](https://claude.com/claude-code) e
> pergunte *"como eu instalo isso?"*. Ele executa tudo o que está abaixo para você.
> Este documento é para quem prefere fazer na mão ou quer entender o que aconteceu.

---

## 0. O que você vai precisar

**Contas (todas com plano grátis):**

| Conta | Para quê | Link |
|-------|----------|------|
| GitHub | Guardar o seu código | github.com |
| Supabase | Banco + backend | supabase.com |
| Vercel | Hospedar o site | vercel.com |
| Groq | IA que responde | console.groq.com |
| Uazapi | Gateway do WhatsApp | uazapi.com |

**Na sua máquina:** Node.js 18+, npm, Git e a [Supabase CLI](https://supabase.com/docs/guides/cli).

**Credenciais que você vai coletar pelo caminho:**

- Supabase: `Reference ID` (`<REF>`), `Project URL`, `anon / publishable key`
- Groq: uma API key (`gsk_...`)
- Uazapi: `Server URL`, `Admin Token` (e depois um `Instance Token`)

> As chaves de Groq e Uazapi **não vão para arquivo nenhum** — você digita dentro do
> app no passo 9. Só as 3 variáveis do Supabase (que são públicas) vão para o `.env`.

---

## 1. Baixar e instalar dependências

```bash
cd q7pipeline
npm install
```

---

## 2. Criar o projeto no Supabase

1. https://supabase.com → **New project**
2. Nome (ex.: `q7-crm`), senha de banco forte, região mais próxima, plano **Free**
3. Espere provisionar (~2 min)
4. Anote em **Project Settings → General**: o **Reference ID** → seu `<REF>`
5. Anote em **Project Settings → API**:
   - **Project URL** → `https://<REF>.supabase.co`
   - **anon / publishable key** → começa com `eyJ...` ou `sb_publishable_...`

> Nunca use a `service_role` key nos passos seguintes. Ela dá acesso total ao banco.

---

## 3. Habilitar as extensões

No painel: **Database → Extensions**, procure e ative:

- `pg_cron`
- `pg_net`

São necessárias para os follow-ups automáticos e funcionam no plano Free. Faça isso
**antes** do passo 4 — assim a migration habilita tudo de uma vez.

---

## 4. Criar o banco

Todo o banco (11 tabelas, RLS, triggers, Realtime) está em **sete arquivos**, que
precisam ser aplicados **nesta ordem**:

1. `supabase/migrations/20260101000000_q7_init.sql` (schema base)
2. `supabase/migrations/20260928120000_reports_and_deal_tracking.sql` (valor da
   venda, ganha/perdida e a tela de Relatórios)
3. `supabase/migrations/20260929000000_team_and_commission.sql` (login por
   vendedor, nível, parcelas/comissão e meta mensal)
4. `supabase/migrations/20260929120000_installment_due_day.sql` (dia de
   vencimento escolhido pelo cliente, para calcular a data exata de cada parcela)
5. `supabase/migrations/20260929130000_commission_actuals.sql` (comissão real
   recebida, preenchida à mão mês a mês)
6. `supabase/migrations/20260929140000_pipeline_stage_funnel.sql` (funil padrão de
   6 colunas e a coluna "Fidelizado", para clientes com todas as parcelas quitadas)
7. `supabase/migrations/20260929150000_opening_message_template.sql` (modelo de
   mensagem de abertura do botão "Novo contato", para o 1º contato do PAP)

**Opção A — pelo painel (mais simples):**

1. **SQL Editor → New query**
2. Cole o **conteúdo inteiro** do primeiro arquivo → **Run** — deve terminar sem erros
3. Repita para os demais arquivos, na mesma ordem

**Opção B — pela CLI:**

```bash
supabase login
supabase link --project-ref <REF>
supabase db push
```

> Os sete arquivos são **idempotentes**: se der erro no meio, corrija a causa e rode
> de novo. Não é preciso apagar o projeto.

Isso cria `profiles`, `user_roles`, `whatsapp_instances`, `pipeline_stages`,
`conversations`, `messages`, `agent_configs`, `followups`, `app_settings`,
`sale_installments` e `commission_actuals`, mais o gatilho que torna o **primeiro
usuário admin** e cria os 6 estágios do funil padrão (Prospecção, Lead, Agendamento,
Fechado, Fidelizado e Perdido).

---

## 5. Deploy das Edge Functions

São 6. **Duas** recebem chamadas externas sem login (o webhook da Uazapi e o cron) e
precisam ir com `--no-verify-jwt`:

```bash
supabase functions deploy whatsapp-webhook  --no-verify-jwt --project-ref <REF>
supabase functions deploy run-followups     --no-verify-jwt --project-ref <REF>
supabase functions deploy manage-instance    --project-ref <REF>
supabase functions deploy test-ai-connection --project-ref <REF>
supabase functions deploy test-uazapi        --project-ref <REF>
supabase functions deploy admin-manage-team  --project-ref <REF>
```

**Você NÃO precisa configurar secrets.** As funções recebem `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` automaticamente, e leem as chaves de Groq e Uazapi direto
do banco (que você preenche pela interface no passo 9).

Confirme que o webhook está público:

```bash
curl -X POST https://<REF>.supabase.co/functions/v1/whatsapp-webhook \
  -H "Content-Type: application/json" -d '{"event":"ping"}'
# esperado: HTTP 200.  Se vier 401, refaça o deploy com --no-verify-jwt.
```

---

## 6. Agendar o cron dos follow-ups

1. Abra `supabase/setup/cron.sql`
2. Substitua `<PROJECT_REF>` pelo seu `<REF>` e `<ANON_KEY>` pela sua anon key
3. Cole no **SQL Editor** e **Run**

```sql
SELECT jobid, jobname, schedule, active FROM cron.job;
-- esperado: 1 linha, '* * * * *', active = true
```

> Esse cron roda `run-followups` a cada minuto. De quebra, mantém o projeto Free
> ativo — projetos Free pausam após 7 dias de inatividade.

---

## 7. Testar localmente

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

Preencha as 3 variáveis com os dados do passo 2, e então:

```bash
npm run check   # confere .env, conexão, as 11 tabelas e as 6 functions
npm run dev     # http://localhost:8080
```

Se aparecer uma tela laranja de **"Configuração incompleta"**, ela mostra exatamente
qual variável está faltando ou errada. Corrija o `.env` e reinicie o `npm run dev` —
variáveis `VITE_*` entram no build, não são lidas em tempo real.

---

## 8. Subir para o GitHub e publicar na Vercel

```bash
git init
git add .
git status          # confira que .env e .mcp.json NÃO aparecem
git commit -m "Q7 Pipeline — instalação inicial"
```

Crie um repositório vazio em github.com/new e:

```bash
git remote add origin https://github.com/<usuario>/<repo>.git
git branch -M main
git push -u origin main
```

Na Vercel:

1. **Add New → Project → Import** o repositório
2. A Vercel detecta Vite sozinha (o `vercel.json` já define build e fallback de SPA)
3. Em **Environment Variables**, adicione:

   | Nome | Valor |
   |------|-------|
   | `VITE_SUPABASE_URL` | `https://<REF>.supabase.co` |
   | `VITE_SUPABASE_PROJECT_ID` | `<REF>` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | sua anon / publishable key |

4. **Deploy**

```bash
curl -I https://<seu-app>.vercel.app   # esperado: HTTP/2 200
```

> Adicionou as variáveis **depois** do primeiro deploy? Faça um **Redeploy**. Sem
> reconstruir, o site continua mostrando a tela de "Configuração incompleta".

---

## 9. Primeiro acesso e configuração

### 9.1 Criar seu usuário admin

> ⚠️ **O passo 4 tem que estar concluído ANTES deste cadastro.** O que transforma o
> primeiro usuário em admin e cria o funil é um gatilho do banco, que só dispara no
> momento do cadastro. Se você se cadastrar antes, sua conta fica **sem perfil, sem
> admin e sem Kanban** — e rodar a migration depois **não conserta**.
> Se acontecer: **Authentication → Users**, apague o usuário e cadastre-se de novo.

1. Abra `https://<seu-app>.vercel.app`
2. Cadastre-se. **O primeiro cadastro vira admin** e já recebe os 6 estágios do funil
   padrão (Prospecção, Lead, Agendamento, Fechado, Fidelizado, Perdido).

### 9.2 Configurar Uazapi e Groq (pela interface)

1. Logado, abra as **Configurações** (ícone de engrenagem)
2. **Uazapi:** `Server URL`, `Admin Token`, `Instance Token`
3. **Groq:** cole a API key (`gsk_...`), escolha `llama-3.3-70b-versatile` e escreva o
   **prompt do agente** (a personalidade do atendimento)
4. **Ative o agente** (toggle ON) — sem isso a IA não responde

> Essas credenciais ficam no seu banco (`app_settings` e `agent_configs`), visíveis só
> para o admin — nunca no código.

### 9.3 Fechar os cadastros

Este CRM é **só seu**. Depois que seu admin existir, desligue cadastros novos:

**Authentication → Sign In / Providers → Email** → desmarque
**"Allow new users to sign up"** → Save.

Seu login continua funcionando. Se um dia precisar de outro usuário, reative, cadastre
e desligue de novo.

---

## 10. Conectar o WhatsApp

1. Nas configurações da Uazapi dentro do app, **crie/conecte a instância** e escaneie o
   **QR Code** com o WhatsApp do número de atendimento.
2. Aponte o **webhook** da instância para:
   ```
   https://<REF>.supabase.co/functions/v1/whatsapp-webhook
   ```
   Pelo botão dentro do app **ou** direto no painel da Uazapi. Eventos: `messages` e
   `connection`.
3. Confirme na interface que a instância aparece como **conectada**.

---

## 11. Teste

De outro celular, mande `oi` para o número conectado. Em ~10s a IA deve responder e a
conversa deve aparecer no painel em "Novo Lead".

Para a validação completa (takeover, follow-ups, Kanban, RLS, resiliência), siga
**[TESTING.md](TESTING.md)** — 14 Waves.

---

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---------|----------------|-------------|
| Tela laranja "Configuração incompleta" | Faltam as `VITE_*` | A tela diz qual variável. Na Vercel: adicione e **Redeploy** |
| Login dá erro | anon key de outro projeto | Confira que URL e key são do **mesmo** projeto |
| Cadastrou mas não virou admin, sem Kanban | Cadastro antes do passo 4 | Authentication → Users → apagar o usuário → cadastrar de novo |
| `404` ao dar refresh em `/kanban` | Fallback de SPA | O `vercel.json` resolve; confirme que subiu para o repositório |
| Webhook retorna 401 | Deploy sem `--no-verify-jwt` | Refaça o deploy de `whatsapp-webhook` com a flag |
| WhatsApp não chega no painel | Webhook errado | Deve apontar para `...supabase.co/functions/v1/whatsapp-webhook`, não para a Vercel |
| IA não responde | Groq não configurada / agente OFF | Configurações → cole a key e ative o toggle |
| Follow-ups não disparam | Cron ou extensões | Ative `pg_cron` + `pg_net` e rode `supabase/setup/cron.sql` |
| `cron.job` não existe | `pg_cron` não habilitado | Database → Extensions → ativar `pg_cron` |
| "Instância expirou" | Instance Token inválido | Recrie a instância na Uazapi e atualize o token no app |
| `npm install` falha no `xlsx` | Vem de CDN, não do npm | Verifique a conexão e tente de novo |

Travou em algo que não está aqui? Abra a pasta no Claude Code e descreva o erro —
o [CLAUDE.md](CLAUDE.md) tem o diagnóstico completo.

---

## Checklist final

- [ ] `pg_cron` e `pg_net` habilitados
- [ ] As 7 migrations aplicadas, nesta ordem (11 tabelas criadas)
- [ ] 6 Edge Functions deployadas (webhook e run-followups com `--no-verify-jwt`)
- [ ] Cron agendado e `active = true`
- [ ] `npm run check` passando
- [ ] Frontend na Vercel respondendo 200
- [ ] Usuário admin criado — **migration aplicada ANTES do cadastro**
- [ ] Uazapi e Groq configuradas na interface, agente ON
- [ ] WhatsApp conectado e webhook apontando para o Supabase
- [ ] Mensagem de teste respondida pela IA
- [ ] Cadastros públicos desligados

Tudo marcado? Seu CRM está no ar. 🚀
