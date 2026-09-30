-- =============================================================================
-- Q7 / CPOS Vendas — rastreio de vendas para a tela de Relatórios
-- =============================================================================
-- Migration ADITIVA — não mexe no arquivo original (20260101000000_q7_init.sql).
-- Aplique DEPOIS dele, na mesma sessão (SQL Editor, `supabase db push` ou
-- `apply_migration`). É IDEMPOTENTE: pode rodar de novo sem erro.
--
-- O que adiciona:
--   • conversations.deal_value  — valor (R$) da venda, editável a qualquer momento
--   • conversations.closed_at   — quando o lead virou venda GANHA (automático)
--   • conversations.lost_at     — quando o lead virou venda PERDIDA (automático)
--   • pipeline_stages.is_won / is_lost — qual coluna do Kanban conta como o quê
--     (os nomes das colunas são livres/editáveis pelo usuário, então isso não
--     pode depender do texto "Fechado")
--   • gatilho que preenche closed_at/lost_at sozinho quando um card muda de
--     coluna — a tela de Relatórios só lê essas duas colunas, não precisa
--     adivinhar nada a partir do nome do estágio.
-- =============================================================================

-- 1. Novas colunas -----------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS deal_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS is_won boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_lost boolean NOT NULL DEFAULT false;

-- Uma coluna não pode ser as duas coisas ao mesmo tempo.
DO $$ BEGIN
  ALTER TABLE public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_not_won_and_lost CHECK (NOT (is_won AND is_lost));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_closed_at
  ON public.conversations (user_id, closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_lost_at
  ON public.conversations (user_id, lost_at) WHERE lost_at IS NOT NULL;

-- Instalações que já rodaram a migration original antes desta (qualquer coluna
-- literalmente chamada "Fechado" vira "ganha" por padrão; ajustável depois no
-- próprio Kanban com o botão de troféu/x).
UPDATE public.pipeline_stages SET is_won = true WHERE name = 'Fechado' AND NOT is_won AND NOT is_lost;

-- RLS: as policies existentes ("Users manage their own stages" / "own_conversations")
-- já cobrem a linha inteira, incluindo estas colunas novas — nada a mudar aqui.

-- 2. Gatilho: preenche closed_at/lost_at sozinho quando o stage_id muda -------
CREATE OR REPLACE FUNCTION public.set_conversation_deal_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  stage_is_won boolean := false;
  stage_is_lost boolean := false;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    IF NEW.stage_id IS NOT NULL THEN
      SELECT is_won, is_lost INTO stage_is_won, stage_is_lost
      FROM public.pipeline_stages WHERE id = NEW.stage_id;
    END IF;
    IF stage_is_won THEN
      NEW.closed_at := now();
      NEW.lost_at := NULL;
    ELSIF stage_is_lost THEN
      NEW.lost_at := now();
      NEW.closed_at := NULL;
    ELSE
      NEW.closed_at := NULL;
      NEW.lost_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_conversation_deal_timestamps ON public.conversations;
CREATE TRIGGER set_conversation_deal_timestamps
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_conversation_deal_timestamps();

-- 3. Seed padrão para usuários NOVOS: agora com 4 estágios --------------------
-- (usuários que já existem não são afetados — isso só roda no cadastro).
CREATE OR REPLACE FUNCTION public.seed_pipeline_stages(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE user_id = _user_id) THEN
    INSERT INTO public.pipeline_stages (user_id, name, position, color, is_won, is_lost) VALUES
      (_user_id, 'Novo Lead',     0, '#3FB8BE', false, false),
      (_user_id, 'Em Negociação', 1, '#F59E0B', false, false),
      (_user_id, 'Fechado',       2, '#10B981', true,  false),
      (_user_id, 'Perdido',       3, '#EF4444', false, true);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seed_pipeline_stages(uuid) FROM PUBLIC, anon, authenticated;
