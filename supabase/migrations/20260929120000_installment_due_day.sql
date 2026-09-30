-- =============================================================================
-- Q7 / CPOS Vendas — dia de vencimento das parcelas
-- =============================================================================
-- Migration ADITIVA — aplique DEPOIS de 20260929000000_team_and_commission.sql,
-- na mesma sessão. É IDEMPOTENTE.
--
-- O que adiciona:
--   • conversations.due_day — o dia do mês (1..31) que o CLIENTE escolheu pra
--     pagar (ex.: "todo dia 30"). Um único campo por venda: todas as parcelas
--     dela vencem nesse dia, começando no mês seguinte à venda.
--
-- Por que não uma coluna due_date por parcela: o dia de vencimento é decidido
-- uma vez, na hora da venda, e vale pra todas as parcelas daquele cliente — não
-- precisa duplicar a mesma informação em cada linha de sale_installments. A
-- data exata de cada parcela é sempre calculável a partir de
-- (mês da venda + número da parcela, dia = due_day, ajustado pro último dia
-- do mês quando due_day não existir naquele mês, ex. dia 30 em fevereiro).
--
-- Vendas antigas (antes desta migration) ficam com due_day NULL — o frontend
-- trata isso como "vence no dia 1 do mês de vencimento", pra não travar em
-- dado que já existe. Editável a qualquer momento no checklist de parcelas.
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS due_day smallint;

DO $$ BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_due_day_check
    CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
