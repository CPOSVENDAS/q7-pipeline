-- =============================================================================
-- Q7 / CPOS Vendas — funil padrão (Prospecção→Lead→Agendamento→Fechado→
-- Fidelizado→Perdido) e coluna "Fidelizado" (cliente que já quitou todas as
-- parcelas, sem cobrança ativa)
-- =============================================================================
-- Migration ADITIVA — aplique DEPOIS de 20260929130000_commission_actuals.sql,
-- na mesma sessão. É IDEMPOTENTE.
--
-- O que adiciona:
--   • pipeline_stages.is_loyalty — mesma filosofia de is_won/is_lost: qual
--     coluna do Kanban é "cliente fidelizado" não depende do NOME da coluna
--     (o usuário pode renomear), só dessa flag. Uma coluna "fidelizado" é
--     sempre também uma venda ganha (is_won fica true junto — o gatilho abaixo
--     garante que isso não pisa no closed_at original da venda).
--   • conserto no gatilho set_conversation_deal_timestamps: antes, mover um
--     card entre DUAS colunas "ganha" (ex.: Fechado → Fidelizado) reescrevia
--     closed_at para agora, o que quebraria a safra/mês da venda em todos os
--     cálculos de comissão e nos gráficos de Relatórios. Agora só carimba
--     closed_at/lost_at na PRIMEIRA vez que a venda entra naquele estado —
--     mover entre colunas do mesmo tipo (duas "ganha", ou ida-e-volta) não
--     mexe na data original.
--   • seed_pipeline_stages() para usuários NOVOS passa a criar 6 colunas:
--     Prospecção, Lead, Agendamento, Fechado, Fidelizado, Perdido.
--   • upgrade best-effort para usuários EXISTENTES cujo funil ainda é
--     EXATAMENTE o default antigo (Novo Lead/Em Negociação/Fechado/Perdido,
--     nas posições 0-3, sem nenhuma flag/nome alterado) — só nesse caso exato
--     ele é expandido para o novo funil de 6 colunas. Qualquer usuário que já
--     renomeou, apagou ou criou colunas próprias não é tocado.
-- =============================================================================

-- 1. Nova flag -----------------------------------------------------------
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS is_loyalty boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_not_loyalty_and_lost CHECK (NOT (is_loyalty AND is_lost));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Gatilho: preserva closed_at/lost_at ao mover entre colunas do mesmo tipo
CREATE OR REPLACE FUNCTION public.set_conversation_deal_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_is_won boolean := false;
  new_is_lost boolean := false;
  old_is_won boolean := false;
  old_is_lost boolean := false;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    IF NEW.stage_id IS NOT NULL THEN
      SELECT is_won, is_lost INTO new_is_won, new_is_lost
      FROM public.pipeline_stages WHERE id = NEW.stage_id;
    END IF;
    IF OLD.stage_id IS NOT NULL THEN
      SELECT is_won, is_lost INTO old_is_won, old_is_lost
      FROM public.pipeline_stages WHERE id = OLD.stage_id;
    END IF;

    IF new_is_won THEN
      -- só carimba na 1ª vez que a venda entra em "ganha" — mover de Fechado
      -- pra Fidelizado (também "ganha") não mexe na data original.
      IF NOT old_is_won THEN
        NEW.closed_at := now();
      END IF;
      NEW.lost_at := NULL;
      -- Mesma regra desde 20260929000000_team_and_commission.sql: se o vendedor
      -- só arrastou o card (sem abrir o checklist de parcelas), a venda entra
      -- como "novo"/4 parcelas por padrão — ele troca depois se for reativação.
      -- Ficou faltando aqui quando esta função foi reescrita nesta migration;
      -- sem isso, nenhuma parcela era criada e a venda nunca virava comissionável.
      IF NEW.client_type IS NULL THEN
        NEW.client_type := 'novo';
        NEW.installment_plan := 4;
      END IF;
    ELSIF new_is_lost THEN
      IF NOT old_is_lost THEN
        NEW.lost_at := now();
      END IF;
      NEW.closed_at := NULL;
    ELSE
      NEW.closed_at := NULL;
      NEW.lost_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- (trigger em si já existe, criado por 20260928120000_reports_and_deal_tracking.sql;
-- CREATE OR REPLACE FUNCTION acima já é suficiente, não precisa recriar o trigger)

-- 3. Seed padrão para usuários NOVOS: agora com 6 estágios --------------------
CREATE OR REPLACE FUNCTION public.seed_pipeline_stages(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE user_id = _user_id) THEN
    INSERT INTO public.pipeline_stages (user_id, name, position, color, is_won, is_lost, is_loyalty) VALUES
      (_user_id, 'Prospecção',  0, '#3FB8BE', false, false, false),
      (_user_id, 'Lead',        1, '#6366F1', false, false, false),
      (_user_id, 'Agendamento', 2, '#F59E0B', false, false, false),
      (_user_id, 'Fechado',     3, '#10B981', true,  false, false),
      (_user_id, 'Fidelizado',  4, '#0EA5E9', true,  false, true),
      (_user_id, 'Perdido',     5, '#EF4444', false, true,  false);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seed_pipeline_stages(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pipeline_stages(uuid) TO authenticated;

-- 4. Upgrade best-effort do funil de usuários EXISTENTES ----------------------
-- Só mexe em quem ainda tem EXATAMENTE o default antigo de 4 colunas (nome +
-- posição + flags, sem nenhuma edição do usuário) — qualquer diferença pula
-- esse usuário inteiro, pra nunca reescrever uma coluna que o usuário mudou.
DO $$
DECLARE
  u record;
  old_lead_id uuid;
  old_neg_id uuid;
  fechado_id uuid;
BEGIN
  FOR u IN
    SELECT user_id FROM public.pipeline_stages
    GROUP BY user_id
    HAVING COUNT(*) = 4
       AND COUNT(*) FILTER (WHERE name = 'Novo Lead'     AND position = 0 AND NOT is_won AND NOT is_lost AND NOT is_loyalty) = 1
       AND COUNT(*) FILTER (WHERE name = 'Em Negociação' AND position = 1 AND NOT is_won AND NOT is_lost AND NOT is_loyalty) = 1
       AND COUNT(*) FILTER (WHERE name = 'Fechado'       AND position = 2 AND is_won     AND NOT is_lost AND NOT is_loyalty) = 1
       AND COUNT(*) FILTER (WHERE name = 'Perdido'       AND position = 3 AND NOT is_won AND is_lost     AND NOT is_loyalty) = 1
  LOOP
    SELECT id INTO old_lead_id FROM public.pipeline_stages WHERE user_id = u.user_id AND name = 'Novo Lead';
    SELECT id INTO old_neg_id  FROM public.pipeline_stages WHERE user_id = u.user_id AND name = 'Em Negociação';
    SELECT id INTO fechado_id  FROM public.pipeline_stages WHERE user_id = u.user_id AND name = 'Fechado';

    UPDATE public.pipeline_stages SET name = 'Prospecção' WHERE id = old_lead_id;
    UPDATE public.pipeline_stages SET name = 'Lead'        WHERE id = old_neg_id;
    -- abre espaço nas posições: Agendamento entra na 2, Fechado/Perdido sobem +1
    UPDATE public.pipeline_stages SET position = position + 1 WHERE user_id = u.user_id AND position >= 2;
    INSERT INTO public.pipeline_stages (user_id, name, position, color, is_won, is_lost, is_loyalty)
      VALUES (u.user_id, 'Agendamento', 2, '#F59E0B', false, false, false);
    INSERT INTO public.pipeline_stages (user_id, name, position, color, is_won, is_lost, is_loyalty)
      VALUES (u.user_id, 'Fidelizado', (SELECT position FROM public.pipeline_stages WHERE id = fechado_id) + 1,
              '#0EA5E9', true, false, true);
    -- reordena as posições seguintes pra não colidir com a nova "Fidelizado"
    UPDATE public.pipeline_stages SET position = position + 1
      WHERE user_id = u.user_id AND id <> (SELECT id FROM public.pipeline_stages WHERE user_id = u.user_id AND name = 'Fidelizado')
        AND position > (SELECT position FROM public.pipeline_stages WHERE id = fechado_id);
  END LOOP;
END $$;
