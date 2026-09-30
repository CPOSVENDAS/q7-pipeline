# TESTING.md — Roteiro E2E pós-deploy (Q7 Pipeline)

Guia completo para validar a aplicação **depois** do deploy no Vercel (frontend) + Supabase próprio (backend, edge functions, cron). Cobre infraestrutura, setup inicial, as 15 Waves funcionais e limpeza pós-teste.

> Substitua `<REF>` pelo ref do seu projeto Supabase (ex.: `abcd1234`).
> Substitua `<VERCEL_URL>` pela URL pública do Vercel (ex.: `q7pipe.vercel.app`).

---

## 1. Pré-requisitos

- [ ] Frontend publicado no Vercel — `https://<VERCEL_URL>` responde 200.
- [ ] Projeto Supabase próprio criado, com as sete migrations aplicadas nesta ordem:
      `supabase/migrations/20260101000000_q7_init.sql`,
      `supabase/migrations/20260928120000_reports_and_deal_tracking.sql`,
      `supabase/migrations/20260929000000_team_and_commission.sql`,
      `supabase/migrations/20260929120000_installment_due_day.sql`,
      `supabase/migrations/20260929130000_commission_actuals.sql`,
      `supabase/migrations/20260929140000_pipeline_stage_funnel.sql` e
      `supabase/migrations/20260929150000_opening_message_template.sql`.
- [ ] Edge Functions deployadas: `whatsapp-webhook`, `run-followups`, `manage-instance`, `test-ai-connection`, `test-uazapi`, `admin-manage-team`.
- [ ] `verify_jwt = false` para `whatsapp-webhook` **e** `run-followups` (em `supabase/config.toml`).
- [ ] Cron configurado via `supabase/setup/cron.sql` (executa `run-followups` a cada minuto).
- [ ] `npm run check` passando sem erros.
- [ ] Conta na **Uazapi** com: Server URL, Admin Token, Instância criada, Instance Token e Webhook apontando para:
  ```
  https://<REF>.supabase.co/functions/v1/whatsapp-webhook
  ```
- [ ] Chave da **Groq** válida (`gsk_...`).
- [ ] Dois números de WhatsApp: um **Cliente** (envia mensagens de teste) e um **Atendente** (número conectado à Uazapi).

---

## 2. Checklist de infraestrutura

### 2.1 Frontend
```bash
curl -I https://<VERCEL_URL>
# esperado: HTTP/2 200
```
- [ ] Rota `/` carrega o login sem erros no console.
- [ ] Toggle dark/light funciona no login.
- [ ] Refresh em rota interna (ex.: `/kanban`) NÃO retorna 404 (SPA fallback OK via `vercel.json`).

### 2.2 Variáveis de ambiente do build
No Vercel → Settings → Environment Variables, confirmar:
- [ ] `VITE_SUPABASE_URL` = `https://<REF>.supabase.co`
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` = anon key do projeto Supabase
- [ ] `VITE_SUPABASE_PROJECT_ID` = `<REF>`

### 2.3 Edge Function pública (webhook)
```bash
curl -X POST https://<REF>.supabase.co/functions/v1/whatsapp-webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"ping"}'
# esperado: HTTP 200 com corpo {"ok":true,...}
```

### 2.4 Cron ativo
No SQL Editor do Supabase:
```sql
select jobid, schedule, command, active from cron.job;
-- esperado: 1 linha com schedule '* * * * *' apontando para run-followups
```

### 2.5 Proteção HIBP
- [ ] Tentar criar conta com senha `password123` → deve ser bloqueada.

---

## 3. Setup inicial

### 3.1 Criar usuário admin
1. Acesse `https://<VERCEL_URL>`.
2. Cadastre-se com o e-mail do administrador (primeiro usuário do sistema).
3. Valide no SQL Editor:
```sql
select p.email, ur.role,
  (select count(*) from pipeline_stages where user_id = p.user_id) as stages
from profiles p
join user_roles ur on ur.user_id = p.user_id
order by p.created_at desc limit 1;
-- esperado: role = 'admin', stages = 3
```

### 3.2 Configurar integrações (ConfigDrawer)
1. Abrir o app logado → botão de configurações (engrenagem).
2. **Uazapi**: preencher Server URL, Admin Token, Instance Name, Instance Token.
3. **Groq**: colar API key e prompt do agente.
4. **Ativar agente** (toggle ON).
5. Clicar **Testar webhook** → deve retornar sucesso (dry_run).

---

## 4. As 15 Waves E2E

> Formato de cada wave: **Objetivo / Passos / Esperado / Verificação SQL**.
> Marque `[x]` quando passar.

### Wave 1 — Primeira mensagem do cliente
- **Objetivo**: IA responde automaticamente via Groq e conversa entra em "Novo Lead".
- **Passos**: Do número Cliente, enviar `oi` para o número Atendente.
- **Esperado**: em até 10s o Cliente recebe resposta gerada pela IA.
- **SQL**:
```sql
select c.contact_phone, c.stage_id, s.name as stage, count(m.*) as msgs
from conversations c
left join pipeline_stages s on s.id = c.stage_id
left join messages m on m.conversation_id = c.id
group by c.id, s.name;
-- esperado: stage = 'Novo Lead', msgs >= 2 (in + out)
```
- [ ] PASS

### Wave 2 — Human takeover
- **Objetivo**: quando o Atendente responde manualmente pelo WhatsApp, a IA para.
- **Passos**: pelo WhatsApp do Atendente, responder manualmente à mesma conversa.
- **Esperado**: mensagem aparece no painel; `human_takeover_at` preenchido; IA não responde nas próximas mensagens do Cliente.
- **SQL**:
```sql
select contact_phone, human_takeover_at from conversations
where human_takeover_at is not null order by human_takeover_at desc;
```
- [ ] PASS

### Wave 3 — IA não retoma automaticamente
- **Objetivo**: confirmar comportamento atual (sem retomada automática).
- **Passos**: aguardar 30+ minutos após Wave 2 e enviar nova mensagem do Cliente.
- **Esperado**: IA permanece em silêncio. UI mostra "Humano assumiu — reative a IA manualmente". Ao clicar em **Reativar IA**, a IA volta a responder.
- **SQL**: após reativação, `human_takeover_at IS NULL` para a conversa.
- [ ] PASS

### Wave 4 — Follow-up manual
- **Objetivo**: agendar follow-up manual e receber no horário.
- **Passos**: na conversa, agendar follow-up em 1 minuto com mensagem "teste follow-up".
- **Esperado**: após ~1 min, Cliente recebe a mensagem; card aparece no painel de pendentes com countdown até disparar.
- **SQL**:
```sql
select send_at, status, kind, text_override from followups order by send_at desc limit 5;
-- esperado: status transita de 'pending' -> 'sent'
```
- [ ] PASS

### Wave 5 — Follow-up automático encadeado
- **Objetivo**: após cada follow-up enviado, o próximo é agendado automaticamente até o limite configurado.
- **Passos**: deixar o agente ativo com auto-follow-up habilitado; aguardar N ciclos.
- **Esperado**: N follow-ups em `status='sent'`, o (N+1)º NÃO é criado.
- **SQL**:
```sql
select conversation_id, count(*) filter (where status='sent') as sent,
  count(*) filter (where status='pending') as pending
from followups group by conversation_id;
```
- [ ] PASS

### Wave 6 — Kanban
- **Objetivo**: gerenciar pipeline visualmente.
- **Passos**: em `/kanban`, arrastar card entre colunas; criar novo estágio; renomear; excluir.
- **Esperado**: mudanças persistem após refresh; Dialogs (não `prompt` do browser) aparecem para criar/editar/excluir.
- **SQL**:
```sql
select name, position, color from pipeline_stages order by position;
```
- [ ] PASS

### Wave 7 — Dois clientes simultâneos
- **Objetivo**: conversas isoladas, sem cruzamento de contexto.
- **Passos**: dois números diferentes enviam mensagens ao mesmo Atendente ao mesmo tempo.
- **Esperado**: duas conversas distintas; respostas da IA usam apenas o histórico da respectiva conversa.
- **SQL**:
```sql
select c.contact_phone, count(m.*) from messages m
join conversations c on c.id = m.conversation_id
group by c.contact_phone order by count desc;
```
- [ ] PASS

### Wave 8 — Mensagens especiais
- **Objetivo**: tratamento correto de mídia, áudio, grupo e mensagens apagadas.
- **Passos**: enviar cada tipo do Cliente.
- **Esperado**:
  - Imagem/áudio: registrada com tipo correspondente, IA responde texto padrão ou ignora conforme prompt.
  - Grupo: mensagens de grupo ignoradas (não criam conversa).
  - Deletadas: não quebram o webhook (sempre 200).
- **Verificação**: logs da função `whatsapp-webhook` sem 5xx.
- [ ] PASS

### Wave 9 — Painel de follow-ups pendentes (Realtime)
- **Objetivo**: contagem regressiva e cancelamento em tempo real.
- **Passos**: agendar follow-up de 5 min; abrir a mesma tela em duas abas; cancelar em uma.
- **Esperado**: countdown atualiza em ambas; ao cancelar, some das duas abas instantaneamente (Realtime).
- **SQL**: `status='cancelled'` na linha correspondente.
- [ ] PASS

### Wave 10 — Reset manual do takeover
- **Objetivo**: botão "Reativar IA" limpa `human_takeover_at`.
- **Passos**: em conversa com takeover ativo, clicar "Reativar IA" e enviar nova mensagem do Cliente.
- **Esperado**: IA responde novamente.
- [ ] PASS

### Wave 11 — Tema dark/light persistente
- **Passos**: alternar tema no login e no dashboard; refresh; logout/login.
- **Esperado**: preferência salva (localStorage) e aplicada em ambos os contextos.
- [ ] PASS

### Wave 12 — Segurança / RLS
- **Objetivo**: usuário B não vê dados de A.
- **Passos**: criar 2º usuário (não-admin); logar; abrir Conversas/Kanban.
- **Esperado**: nenhuma conversa/estágio do admin aparece; `app_settings` inacessível para não-admin.
- **SQL** (com JWT do usuário B via API):
```bash
curl https://<REF>.supabase.co/rest/v1/conversations \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <JWT_USUARIO_B>"
# esperado: [] (nenhuma conversa do admin)
```
- [ ] PASS

### Wave 13 — Resiliência
- **Objetivo**: falhas externas não derrubam o sistema.
- **Passos**:
  1. Trocar chave Groq por valor inválido.
  2. Enviar mensagem do Cliente.
  3. Deixar um follow-up disparar.
- **Esperado**:
  - Webhook responde 200 mesmo com Groq falhando.
  - Follow-up envia mensagem de fallback (não trava o cron).
  - Logs mostram erro, mas sem 5xx.
- **Verificação**: `supabase functions logs whatsapp-webhook` e `run-followups`.
- [ ] PASS

### Wave 14 — Login por vendedor, meta mensal e comissão
- **Objetivo**: cada vendedor enxerga só o próprio Kanban/Conversas; meta e comissão calculam certo.
- **Passos**:
  1. Como admin, em `/admin/equipe`, criar o login de um 2º vendedor e anotar a senha temporária exibida.
  2. Logar com esse novo login em outra janela/aba anônima; confirmar que Kanban e Conversas mostram **zero** conversas do admin (isolamento por `user_id`, mesma RLS da Wave 12).
  3. Definir o nível do vendedor (ex.: Master) e conferir a meta mensal (15 planos) e a tabela de comissão em `/admin/equipe`.
  4. Fechar uma venda ("Ganha") no Kanban do vendedor com um `client_type`/`installment_plan` (ex.: Novo — 4 parcelas); confirmar que o checklist de parcelas aparece no card e na tela de Conversas.
  5. Marcar as parcelas como pagas uma a uma; confirmar que o badge "Comissionável" só liga na última parcela do modelo escolhido (ou automaticamente para reativação de 4 parcelas, que já nasce comissionável).
  6. Abrir `/relatorios` como o vendedor: conferir o KPI "Meta do mês" contando a venda no mês em que foi registrada, o comparativo mês a mês/ano a ano refletindo a venda, e o card "Comissão do mês" usando o nível do vendedor × faixa de adimplência atingida.
- **Esperado**: sem vazamento de dados entre logins; meta e comparativos batem com a contagem real de vendas do mês; comissão exibida = quantidade de vendas comissionáveis no mês × valor unitário da faixa de adimplência atingida para o nível do vendedor (essa é a fórmula implementada — confirme com o negócio se bate com a tabela de comissão real antes de usar em produção).
- **SQL**:
```sql
select p.email, p.seller_level, c.client_type, c.installment_plan, c.commission_eligible, c.closed_at
from conversations c
join profiles p on p.user_id = c.user_id
where c.stage_id in (select id from pipeline_stages where name ilike '%ganh%')
order by c.closed_at desc;

select conversation_id, installment_number, paid, paid_at from sale_installments order by conversation_id, installment_number;
```
- [ ] PASS

### Wave 15 — Funil padrão de 6 colunas e coluna "Fidelizado"
- **Objetivo**: novos cadastros já nascem com o funil completo (Prospecção → Lead → Agendamento → Fechado → Fidelizado → Perdido); o botão "mover p/ Fidelizado" só aparece quando todas as parcelas estão pagas; mover um card entre colunas "ganha" (Fechado ↔ Fidelizado) **não** altera `closed_at` da venda.
- **Passos**:
  1. Cadastrar um usuário novo e confirmar no Kanban as 6 colunas na ordem certa, com "Fechado" e "Fidelizado" marcadas com o badge "Ganha" (troféu) e "Fidelizado" também com o badge próprio (coração).
  2. Fechar uma venda com parcelamento (ex.: Novo — 4 parcelas) e ir marcando as parcelas como pagas uma a uma; confirmar que o botão "Parcelas quitadas — mover p/ Fidelizado" só aparece no card **depois** da última parcela paga (mesmo momento em que `commission_eligible` liga).
  3. Anotar o `closed_at` da venda (`select closed_at from conversations where id = '<id>'`), clicar no botão pra mover pra "Fidelizado", e conferir que `closed_at` **não mudou** — só o `stage_id`.
  4. Conferir em `/relatorios` que essa venda continua contando no mesmo mês/safra de antes de mover (cohort e comissão do mês inalterados pelo move).
  5. Testar o ícone de coração no cabeçalho de uma coluna qualquer: ligar `is_loyalty` deve ligar `is_won` junto (e desligar `is_lost` se estivesse ligado); ligar `is_lost` numa coluna que estava marcada como "Fidelizado" deve desligar `is_loyalty` (checar a constraint `pipeline_stages_not_loyalty_and_lost`).
  6. Num usuário que já existia **antes** desta migration (funil antigo de 4 colunas, sem edição), confirmar que ele foi upgradado sozinho para o funil de 6; num usuário que já tinha renomeado/customizado as colunas, confirmar que **nada mudou** (upgrade automático só mexe em quem está com o default antigo intocado).
- **Esperado**: nenhuma venda muda de mês/safra por causa de um move interno entre colunas "ganha"; usuários com Kanban customizado não são tocados pela migration.
- **SQL**:
```sql
select id, name, position, is_won, is_lost, is_loyalty from pipeline_stages where user_id = '<seu_user_id>' order by position;
select id, stage_id, closed_at, commission_eligible from conversations where id = '<id_da_venda>';
```
- [ ] PASS

---

### Wave 16 — "Novo contato": abertura manual sem travar em modo humano
- **Objetivo**: o botão "Novo contato" (tela de Conversas) permite mandar a primeira mensagem pra um lead do PAP sem passar pelo fluxo normal de takeover humano — a conversa nasce com `ai_enabled = true` e `human_takeover_at = null`, mesmo a mensagem tendo sido digitada pelo vendedor.
- **Passos**:
  1. Em Configurações → "Mensagem de abertura (1º contato)", salvar um modelo de texto.
  2. Em Conversas, clicar "Novo contato", confirmar que o modelo salvo já vem preenchido (editável), preencher nome + telefone, e enviar.
  3. Confirmar: a conversa aparece na lista com o badge **"IA"** (não "Humano"), e o toggle "IA" no cabeçalho da conversa está ligado.
  4. Simular a resposta do cliente (inserir uma mensagem `inbound` direto no banco, ou responder de fato pelo Uazapi de teste) e confirmar que a IA responde sozinha, sem precisar clicar em nada.
  5. **Controle de regressão**: numa conversa **já existente**, digitar uma mensagem manual na caixa de texto normal do chat e confirmar que o comportamento antigo continua — `ai_enabled` vira `false` e aparece "Humano assumiu — reative a IA manualmente" (isso não pode ter sido afetado pela mudança).
  6. Tentar "Novo contato" com um telefone que já tem conversa: confirmar que abre a conversa existente em vez de duplicar.
- **Esperado**: só a abertura pelo botão "Novo contato" é isenta do takeover automático; qualquer outro envio manual (chat normal, celular do vendedor) continua desligando a IA como sempre.
- **SQL**:
```sql
select contact_phone, ai_enabled, human_takeover_at from conversations order by created_at desc limit 5;
```
- [ ] PASS

---

## 5. Observabilidade

### 5.1 Logs das edge functions
No dashboard Supabase → Edge Functions → selecionar função → aba **Logs**.

CLI:
```bash
supabase functions logs whatsapp-webhook --project-ref <REF>
supabase functions logs run-followups   --project-ref <REF>
```

### 5.2 Queries úteis
```sql
-- Últimas 20 mensagens
select m.created_at, m.direction, c.contact_phone, left(m.content, 80) as preview
from messages m
join conversations c on c.id = m.conversation_id
order by m.created_at desc limit 20;

-- Follow-ups pendentes
select id, send_at, status, conversation_id
from followups where status = 'pending' order by send_at;

-- Conversas por estágio
select s.name, count(c.*) as total
from pipeline_stages s
left join conversations c on c.stage_id = s.id
group by s.name order by s.position;

-- Erros recentes (se logar em tabela app_logs)
select * from cron.job_run_details order by start_time desc limit 20;
```

---

## 6. Limpeza pós-teste

Executar no SQL Editor (**mantém** admin, roles e stages padrão):

```sql
delete from messages;
delete from followups;
delete from conversations;
-- Se quiser zerar instâncias/config e reconfigurar do zero:
-- delete from whatsapp_instances;
-- delete from agent_configs;
```

Confirmação:
```sql
select
  (select count(*) from conversations) as conversations,
  (select count(*) from messages) as messages,
  (select count(*) from followups) as followups;
-- esperado: 0, 0, 0
```

---

## 7. Critérios de aceite final

- [ ] Waves 1–14 marcadas como PASS.
- [ ] Zero respostas 5xx nos logs de `whatsapp-webhook` e `run-followups` durante os testes.
- [ ] Build do Vercel sem erros; console do navegador sem erros vermelhos.
- [ ] RLS validada (Wave 12).
- [ ] Cron ativo e disparando a cada minuto.

Se todos os itens acima estiverem OK, o deploy está pronto para produção.