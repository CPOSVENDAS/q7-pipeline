-- =============================================================================
-- Q7 / CPOS Vendas — comissão real recebida, mês a mês
-- =============================================================================
-- Migration ADITIVA — aplique DEPOIS de 20260929120000_installment_due_day.sql,
-- na mesma sessão. É IDEMPOTENTE.
--
-- O que adiciona:
--   • commission_actuals — um valor por (vendedor, ano, mês): quanto ele
--     realmente recebeu de comissão naquele mês. Preenchido à mão pelo próprio
--     vendedor na tela de Relatórios, ao lado do valor PLANEJADO (calculado
--     sozinho pela fórmula de adimplência x tabela de comissão). É só um
--     registro pessoal de conferência — não alimenta nenhum cálculo automático
--     do sistema, só aparece lado a lado com o planejado pra comparação.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.commission_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year smallint NOT NULL,
  month smallint NOT NULL,
  valor_real numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, year, month)
);

DO $$ BEGIN
  ALTER TABLE public.commission_actuals
    ADD CONSTRAINT commission_actuals_month_check CHECK (month >= 0 AND month <= 11);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_commission_actuals_user ON public.commission_actuals (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_actuals TO authenticated;
GRANT ALL ON public.commission_actuals TO service_role;
ALTER TABLE public.commission_actuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_commission_actuals" ON public.commission_actuals;
CREATE POLICY "own_commission_actuals" ON public.commission_actuals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Mantém updated_at em dia a cada UPDATE — reaproveita a mesma função de
-- gatilho já usada por todas as outras tabelas (public.update_updated_at_column,
-- criada em 20260101000000_q7_init.sql), em vez de duplicar a lógica numa
-- função só desta tabela.
DROP TRIGGER IF EXISTS trg_commission_actuals_updated_at ON public.commission_actuals;
CREATE TRIGGER trg_commission_actuals_updated_at
  BEFORE UPDATE ON public.commission_actuals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Limpeza: remove a função dedicada de uma versão anterior desta migration,
-- caso já tenha sido aplicada num banco antes desta correção (sem search_path
-- fixo, e redundante com update_updated_at_column). Não-op em banco novo.
DROP FUNCTION IF EXISTS public.set_commission_actuals_updated_at();
