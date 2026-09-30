# CLAUDE.md — Q7 Pipeline

> Instruções para o Claude Code. Quem estiver lendo este arquivo é o assistente
> que vai **instalar e operar** este projeto para o usuário.

---

## Se o usuário perguntar "como eu instalo isso?"

Não mande ele ler documentação. **Instale para ele.**

1. Responda com um resumo curto do que o Q7 Pipeline é e do que a instalação envolve
   (Supabase + Vercel + WhatsApp + IA, ~20 min com você fazendo o trabalho).
2. Peça **de uma vez só** as credenciais da tabela da [Etapa 1](#etapa-1--coletar-as-credenciais).
   Não pergunte uma por uma.
3. Siga as etapas 0 → 11 na ordem. Não pule etapas.
4. Ao final, rode `npm run check` e mostre o resultado.

Se ele fizer outra pergunta ("por que não funciona?", "como conecto o WhatsApp?",
"onde coloco a chave da IA?"), vá direto para a seção relevante — mas antes
confirme em que ponto da instalação ele está, com `npm run check`.

---

## Regras invioláveis

1. **O banco tem que existir ANTES do primeiro cadastro de usuário.**
   Um gatilho (`on_auth_user_created`) transforma o primeiro usuário em admin e cria
   o funil. Ele só dispara no momento do cadastro. Quem se cadastra antes da
   migration fica com conta órfã — sem perfil, sem admin, sem Kanban — e aplicar
   a migration depois **não conserta**.
   *Conserto:* Authentication → Users → apagar o usuário → cadastrar de novo.

2. **Nunca coloque a `service_role` key no frontend**, no `.env`, ou em qualquer
   variável `VITE_*`. Elas vão para o navegador. Só a `anon` / `publishable` key.

3. **Nunca commite** `.env` nem `.mcp.json`. Ambos já estão no `.gitignore` — confirme
   antes de qualquer `git add`.

4. **Confirme com o usuário antes de qualquer operação destrutiva** no banco
   (`DROP`, `DELETE`, `TRUNCATE`, apagar usuário, resetar projeto). Diga exatamente
   o que será perdido.

5. **O schema vive em sete migrations, nesta ordem:**
   `supabase/migrations/20260101000000_q7_init.sql` (base),
   `supabase/migrations/20260928120000_reports_and_deal_tracking.sql` (valor da venda,
   ganha/perdida e a tela de Relatórios),
   `supabase/migrations/20260929000000_team_and_commission.sql` (login por vendedor,
   nível, parcelas/comissão e meta mensal),
   `supabase/migrations/20260929120000_installment_due_day.sql` (dia de vencimento
   escolhido pelo cliente, usado para calcular a data exata de cada parcela),
   `supabase/migrations/20260929130000_commission_actuals.sql` (comissão real recebida,
   preenchida à mão mês a mês, lado a lado com a planejada),
   `supabase/migrations/20260929140000_pipeline_stage_funnel.sql` (funil padrão de 6
   colunas — Prospecção/Lead/Agendamento/Fechado/Fidelizado/Perdido — e a coluna
   "Fidelizado" para clientes com todas as parcelas quitadas) e
   `supabase/migrations/20260929150000_opening_message_template.sql` (modelo de
   mensagem de abertura pro botão "Novo contato" em Conversas, usado no 1º contato
   do PAP). Não crie schema em outro lugar, não invente SQL paralelo. Se precisar
   alterar o banco, crie uma **nova** migration com timestamp posterior às sete.

6. **A migration é idempotente.** Se der erro no meio, corrija a causa e rode de novo.
   Nunca recomende "apague o projeto e comece de novo" como primeira solução.

---

## O que é este projeto

CRM de atendimento por WhatsApp onde a **IA responde sozinha**, com funil Kanban e
follow-ups automáticos. Cada instalação é independente: infraestrutura e chaves do
próprio usuário, sem plataforma proprietária no meio.

| Camada | Tecnologia | Onde roda |
|--------|-----------|-----------|
| Frontend | Vite + React 18 + TypeScript + shadcn/ui + Tailwind | Vercel |
| Banco + Auth + Realtime | Postgres + Supabase Auth (RLS) | Supabase |
| Backend | 6 Edge Functions (Deno) | Supabase |
| WhatsApp | Uazapi (gateway) | conta do usuário |
| IA | Groq (`llama-3.3-70b-versatile`) | conta do usuário |

**O webhook do WhatsApp roda no Supabase, não na Vercel.** A Vercel só serve o site
estático. A Uazapi aponta para `https://<REF>.supabase.co/functions/v1/whatsapp-webhook`.

Funcionalidades: atendimento automático por IA, *human takeover* (se o humano responde,
a IA pausa naquela conversa), funil Kanban arrastável, follow-ups manuais e automáticos
em cadeia, multiusuário com isolamento por RLS.

---

## Como você acessa o Supabase do usuário

Existem dois caminhos. **Detecte qual está disponível antes de começar.**

### Caminho A — MCP Supabase (preferido)

Se você tem as ferramentas `mcp__supabase__*` disponíveis, use-as. É o caminho mais
confiável para o banco: `apply_migration`, `execute_sql`, `list_tables`, `get_advisors`,
`get_logs`.

Se **não** tiver, ofereça configurar (leva ~2 min):

1. Copiar `.mcp.json.example` para `.mcp.json`
2. No arquivo, trocar `SEU_PROJECT_REF` pelo ref do projeto e `SEU_ACCESS_TOKEN` por
   um Personal Access Token criado em https://supabase.com/dashboard/account/tokens
3. Remover o bloco `_comentario`
4. **Fechar e reabrir o Claude Code**, e aprovar o servidor quando ele perguntar

Diga claramente que ele vai precisar reiniciar a sessão — e que, ao voltar, é só pedir
"continue a instalação".

### Caminho B — Supabase CLI (alternativa / fallback)

Funciona sem reiniciar nada. Requer a CLI instalada:

```bash
npm i -g supabase
supabase login
supabase link --project-ref <REF>
```

**Use sempre o Caminho B para as Edge Functions.** O `deploy_edge_function` do MCP
exige que você monte manualmente a lista de arquivos, e estas funções importam
`../_shared/*.ts` — a CLI resolve isso nativamente, sem margem para erro. Se o usuário
não quiser instalar a CLI, tente o MCP incluindo os arquivos de `_shared/` no
parâmetro `files` e **confirme o resultado com `npm run check`**.

### Caminho C — manual (último recurso)

Se nada acima estiver disponível, guie o usuário a colar SQL no **SQL Editor** do
painel e a criar as funções pelo painel. Funciona, mas é lento — ofereça primeiro A ou B.

---

## Instalação — procedimento completo

### Etapa 0 — Pré-requisitos

```bash
node --version   # precisa ser 18 ou maior
npm install
```

Se `npm install` falhar no pacote `xlsx` (vem de CDN, não do registry npm), verifique
a conexão e tente de novo. É a única dependência fora do registry.

### Etapa 1 — Coletar as credenciais

Peça tudo de uma vez. Se o usuário ainda não tem alguma conta, mande o link e espere.

| O que | Onde pegar | Usado em |
|-------|-----------|----------|
| **Supabase** — Reference ID (`<REF>`) | Project Settings → General | tudo |
| **Supabase** — Project URL | Project Settings → API | `.env`, Vercel |
| **Supabase** — anon / publishable key | Project Settings → API | `.env`, Vercel, cron |
| **Groq** — API key (`gsk_...`) | https://console.groq.com/keys | digitada no app (etapa 9) |
| **Uazapi** — Server URL + Admin Token | painel da Uazapi | digitada no app (etapa 9) |
| **GitHub** — conta | — | etapa 7 |
| **Vercel** — conta | — | etapa 8 |

> **Groq e Uazapi não vão para arquivo nenhum.** São digitadas na interface do app e
> guardadas no banco (`agent_configs`, `app_settings`), visíveis só para o admin.
> Só as 3 variáveis `VITE_*` do Supabase — que são públicas por natureza — vão para
> o `.env` e para a Vercel.

Se o usuário ainda **não criou** o projeto Supabase: mande criar em
https://supabase.com → New project, plano Free, região mais próxima, e anotar a senha
do banco. Leva ~2 min para provisionar.

### Etapa 2 — Conectar

Escolha o Caminho A ou B da seção anterior e confirme que a conexão funciona antes de
seguir (`list_tables` no MCP, ou `supabase projects list` na CLI).

### Etapa 3 — Banco de dados

Aplique, **nesta ordem**, as sete migrations:

1. `supabase/migrations/20260101000000_q7_init.sql` (schema base)
2. `supabase/migrations/20260928120000_reports_and_deal_tracking.sql` (valor da venda,
   ganha/perdida e a tela de Relatórios)
3. `supabase/migrations/20260929000000_team_and_commission.sql` (login por vendedor,
   nível, parcelas/comissão e meta mensal)
4. `supabase/migrations/20260929120000_installment_due_day.sql` (dia de vencimento
   escolhido pelo cliente, usado para calcular a data exata de cada parcela)
5. `supabase/migrations/20260929130000_commission_actuals.sql` (comissão real recebida,
   preenchida à mão mês a mês)
6. `supabase/migrations/20260929140000_pipeline_stage_funnel.sql` (funil padrão de 6
   colunas e a coluna "Fidelizado")
7. `supabase/migrations/20260929150000_opening_message_template.sql` (modelo de
   mensagem de abertura do botão "Novo contato")

- **MCP:** leia cada arquivo e chame `apply_migration({ name: "q7_init", query: <conteúdo> })`,
  depois `apply_migration({ name: "reports_and_deal_tracking", query: <conteúdo> })`,
  depois `apply_migration({ name: "team_and_commission", query: <conteúdo> })`,
  depois `apply_migration({ name: "installment_due_day", query: <conteúdo> })`,
  depois `apply_migration({ name: "commission_actuals", query: <conteúdo> })`,
  depois `apply_migration({ name: "pipeline_stage_funnel", query: <conteúdo> })`,
  depois `apply_migration({ name: "opening_message_template", query: <conteúdo> })`
- **CLI:** `supabase db push` (aplica as sete de uma vez, na ordem dos timestamps)
- **Manual:** colar o conteúdo de cada arquivo no SQL Editor → Run, um de cada vez, na ordem acima

Depois, **habilite as extensões** em Database → Extensions do painel: `pg_cron` e `pg_net`.
A migration tenta habilitar sozinha, mas se o Postgres recusar por permissão ela emite
um `NOTICE` e segue — o CRM funciona, só os follow-ups automáticos ficam parados.

**Verifique** que as 11 tabelas existem: `profiles`, `user_roles`, `whatsapp_instances`,
`pipeline_stages`, `conversations`, `messages`, `agent_configs`, `followups`, `app_settings`,
`sale_installments`, `commission_actuals`.

Rode `get_advisors` (MCP) se disponível e reporte qualquer alerta de segurança.

### Etapa 4 — Edge Functions

São 6. Duas recebem chamadas externas **sem login** e precisam de `verify_jwt = false`:

```bash
supabase functions deploy whatsapp-webhook  --no-verify-jwt --project-ref <REF>
supabase functions deploy run-followups     --no-verify-jwt --project-ref <REF>
supabase functions deploy manage-instance    --project-ref <REF>
supabase functions deploy test-ai-connection --project-ref <REF>
supabase functions deploy test-uazapi        --project-ref <REF>
supabase functions deploy admin-manage-team  --project-ref <REF>
```

Via MCP, o equivalente é `deploy_edge_function` com `verify_jwt: false` para as duas
primeiras e `true` para as outras quatro — incluindo os arquivos de `supabase/functions/_shared/`
no array `files`.

**Não configure secrets.** As funções recebem `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`
automaticamente do Supabase, e leem as chaves de Groq e Uazapi direto do banco.

Confirme que o webhook está público:

```bash
curl -X POST https://<REF>.supabase.co/functions/v1/whatsapp-webhook \
  -H "Content-Type: application/json" -d '{"event":"ping"}'
# esperado: HTTP 200. Se vier 401, o deploy foi sem --no-verify-jwt.
```

### Etapa 5 — Cron dos follow-ups

1. Abra `supabase/setup/cron.sql`
2. Substitua `<PROJECT_REF>` e `<ANON_KEY>` pelos valores reais
3. Execute (SQL Editor, `execute_sql` do MCP, ou CLI)

```sql
SELECT jobid, jobname, schedule, active FROM cron.job;
-- esperado: 1 linha, '* * * * *', active = true
```

Esse cron roda a cada minuto e, de quebra, mantém o projeto Free ativo (projetos Free
pausam após 7 dias sem uso).

Se falhar com erro de schema `cron` inexistente, volte e habilite `pg_cron` (etapa 3).

### Etapa 6 — Rodar local e validar

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

Preencha as 3 variáveis, depois:

```bash
npm run check   # valida .env, conexão, 11 tabelas e 6 functions
npm run dev     # http://localhost:8080
```

Se abrir uma tela laranja de "Configuração incompleta", ela diz exatamente qual
variável está errada. Corrija e reinicie o `npm run dev` (variáveis `VITE_*` entram
no build, não são lidas em tempo real).

### Etapa 7 — GitHub

O projeto vem **sem** repositório git. Crie um:

```bash
git init
git add .
git commit -m "Q7 Pipeline — instalação inicial"
```

Antes do commit, confirme que `.env` e `.mcp.json` **não** estão na lista
(`git status`). Se aparecerem, pare e corrija o `.gitignore`.

Com o `gh` CLI disponível:

```bash
gh auth status                                  # se não estiver logado: gh auth login
gh repo create q7-pipeline --private --source=. --push
```

Sem o `gh`: mande o usuário criar o repositório vazio em github.com/new e então:

```bash
git remote add origin https://github.com/<usuario>/<repo>.git
git branch -M main
git push -u origin main
```

Para mudanças posteriores, trabalhe em branch e abra PR — não faça commit direto na
`main` sem o usuário pedir.

### Etapa 8 — Vercel

1. https://vercel.com → Add New → Project → Import do repositório
2. A Vercel detecta Vite sozinha (o `vercel.json` já define build e o fallback de SPA)
3. Em **Environment Variables**, adicione as 3:

| Nome | Valor |
|------|-------|
| `VITE_SUPABASE_URL` | `https://<REF>.supabase.co` |
| `VITE_SUPABASE_PROJECT_ID` | `<REF>` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | a anon / publishable key |

4. Deploy

> Se o usuário adicionar as variáveis **depois** do primeiro deploy, é obrigatório
> um **Redeploy**. Variáveis `VITE_*` são injetadas no build; sem reconstruir, o site
> continua mostrando a tela de "Configuração incompleta".

```bash
curl -I https://<seu-app>.vercel.app   # esperado: HTTP/2 200
```

### Etapa 9 — Primeiro acesso e configuração

⚠️ **Confirme que a etapa 3 está concluída antes deste cadastro** (regra 1).

1. Abra a URL da Vercel e **cadastre-se**. Esse primeiro usuário vira admin
   automaticamente e recebe os 6 estágios do funil padrão — Prospecção, Lead,
   Agendamento, Fechado, Fidelizado e Perdido (as duas últimas colunas existem desde
   que as migrations `20260928120000_reports_and_deal_tracking.sql` e
   `20260929140000_pipeline_stage_funnel.sql` foram aplicadas).
2. Logado, abra **Configurações** (ícone de engrenagem):
   - **Uazapi:** Server URL, Admin Token, Instance Token
   - **Groq:** API key (`gsk_...`), modelo `llama-3.3-70b-versatile`, e o
     **prompt do agente** (a personalidade do atendimento)
   - **Ative o agente** (toggle ON) — sem isso a IA não responde
3. Ainda nas configurações, **crie/conecte a instância** da Uazapi e escaneie o QR Code
   com o WhatsApp do número de atendimento.
4. Aponte o webhook da instância para:
   `https://<REF>.supabase.co/functions/v1/whatsapp-webhook`
   (pelo botão dentro do app ou pelo painel da Uazapi). Eventos: `messages` e `connection`.

### Etapa 10 — Fechar os cadastros

O CRM é de uso pessoal do usuário. Depois que o admin dele existir, desligue cadastros
novos para ninguém mais abrir conta na stack dele:

Supabase → Authentication → Sign In / Providers → Email → desmarcar
**"Allow new users to sign up"** → Save.

O login dele continua funcionando normalmente.

### Etapa 11 — Verificação final

```bash
npm run check
```

Depois, teste de ponta a ponta: mande `oi` de outro celular para o número conectado.
Em ~10s a IA deve responder e a conversa deve aparecer em "Novo Lead".

Para a bateria completa (takeover, follow-ups, Kanban, RLS, resiliência), use
[TESTING.md](TESTING.md) — 15 Waves.

---

## Problemas comuns

| Sintoma | Causa | Solução |
|---------|-------|---------|
| Tela laranja "Configuração incompleta" | Faltam as `VITE_*` | A própria tela diz qual variável. Na Vercel, adicione e **Redeploy** |
| Site em branco / erro no console | Build antigo, anterior à correção | `npm run build` de novo e redeploy |
| Login dá erro | anon key de outro projeto | Confira URL e key do **mesmo** projeto |
| Cadastrou mas não é admin, sem Kanban | Cadastro feito antes da migration | Authentication → Users → apagar o usuário → cadastrar de novo |
| `404` ao dar refresh em `/kanban` | Fallback de SPA | O `vercel.json` já resolve; confirme que subiu para o repositório |
| Webhook retorna 401 | Deploy sem `--no-verify-jwt` | Refaça o deploy de `whatsapp-webhook` com a flag |
| WhatsApp não aparece no painel | Webhook apontando errado | Deve ser `https://<REF>.supabase.co/functions/v1/whatsapp-webhook`, não a Vercel |
| IA não responde | Groq não configurada ou agente OFF | Configurações → cole a key e ative o toggle |
| Follow-ups não disparam | Cron ou extensões | Habilite `pg_cron` + `pg_net` e rode `supabase/setup/cron.sql` |
| `cron.job` não existe | `pg_cron` não habilitado | Database → Extensions → ativar `pg_cron` |
| `npm run build` falha com `Rollup failed to resolve import "react-is"` | O `recharts` depende de `react-is`, mas em algumas instalações (Windows, `npm install` recém-rodado) ele não é resolvido sozinho | `npm install react-is` (já está fixado no `package.json` — se aparecer de novo, o `package-lock.json` está desatualizado) |
| "Instância expirou" | Instance Token inválido | Recrie a instância na Uazapi e atualize o token no app |
| Projeto Supabase pausou | Free pausa após 7 dias parado | Restaure no painel; o cron da etapa 5 evita que aconteça |

Para logs das Edge Functions: `get_logs` (MCP) ou Supabase → Edge Functions → Logs.

---

## Comandos

```bash
npm install       # dependências
npm run dev       # dev server em http://localhost:8080
npm run build     # build de produção em dist/
npm run check     # verifica .env, conexão, 11 tabelas e 6 edge functions
npm run lint      # eslint
```

`npm run check` também aceita alvo explícito, sem depender do `.env`:

```bash
npm run check -- https://<REF>.supabase.co <ANON_KEY>
```

---

## Estrutura

```
├── CLAUDE.md                  # este arquivo
├── INSTALL.md                 # o mesmo passo a passo, para leitura humana
├── TESTING.md                 # validação E2E (15 Waves)
├── .env.example               # modelo das 3 variáveis do frontend
├── .mcp.json.example          # modelo da conexão MCP com o Supabase
├── scripts/check-setup.mjs    # verificador de instalação
├── src/
│   ├── lib/env.ts             # valida as variáveis antes de criar o client
│   ├── lib/installments.ts    # modelos de parcela e regra de comissão
│   ├── pages/SetupRequired.tsx# tela de diagnóstico quando falta configuração
│   ├── pages/                 # Login, Conversas, Kanban, Relatorios, admin/UazapiConfig, admin/Equipe
│   ├── components/            # ConfigDrawer, InstallmentChecklist, rotas protegidas, ui/ (shadcn)
│   ├── contexts/AuthContext   # sessão do Supabase Auth
│   └── integrations/supabase/ # client + tipos gerados
└── supabase/
    ├── migrations/            # fonte de verdade do banco (7 arquivos, aplicar em ordem)
    ├── setup/cron.sql         # agendamento dos follow-ups (tem placeholders)
    ├── config.toml            # verify_jwt das funções
    └── functions/             # 6 edge functions + _shared/
```

### Notas sobre o código

- `supabase/functions/_shared/get-ai-config.ts` — lê a config da IA do banco, com
  fallback para a env `GROQ_API_KEY`. Também resolve a cadeia de modelos da Groq.
- `supabase/functions/_shared/get-uazapi-config.ts` — lê a config da Uazapi de
  `app_settings`, com cache de 60s. O fallback para envs `OUTREE_UAZAPI_*` é resquício
  de compatibilidade; pode ignorar.
- `src/integrations/supabase/types.ts` é **gerado**. Se alterar o schema, regenere
  (`generate_typescript_types` no MCP, ou `supabase gen types typescript`).
- A tabela `app_settings` é global e admin-only; `agent_configs` é por usuário.
