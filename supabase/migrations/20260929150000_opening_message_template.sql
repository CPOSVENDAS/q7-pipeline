-- =============================================================================
-- Q7 / CPOS Vendas — mensagem de abertura (1º contato do PAP) + IA assume depois
-- =============================================================================
-- Migration ADITIVA — aplique DEPOIS de 20260929140000_pipeline_stage_funnel.sql,
-- na mesma sessão. É IDEMPOTENTE.
--
-- Contexto: o vendedor faz prospecção porta a porta (PAP) e, ao chegar em casa,
-- quer mandar ele mesmo a mensagem de abertura pro cliente que acabou de visitar
-- ("Oi, aqui é o Fulano da Empresa..."), mas SEM que isso "trave" a conversa em
-- modo humano pra sempre — a IA deve assumir sozinha a partir da resposta do
-- cliente, do jeito que ela já assume em qualquer outra conversa nova.
--
-- Essa migration só guarda um MODELO de texto reutilizável (editável em
-- Configurações), pra não precisar redigitar a mesma apresentação toda vez.
-- Ela não muda nenhuma regra de negócio sozinha — quem muda o comportamento de
-- "não travar em modo humano" é o código do frontend (tela de Conversas), que
-- cria a conversa e manda essa mensagem sem tocar em ai_enabled/human_takeover_at
-- (ambos ficam no valor padrão: true / null — IA já ligada para essa conversa).
-- =============================================================================

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS opening_message_template text;
