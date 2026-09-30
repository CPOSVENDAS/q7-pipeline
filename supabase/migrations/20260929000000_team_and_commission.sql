-- =============================================================================
-- Q7 / CPOS Vendas — equipe (múltiplos logins), meta mensal e comissão por parcelas
-- =============================================================================
-- Migration ADITIVA — aplique DEPOIS de 20260101000000_q7_init.sql e
-- 20260928120000_reports_and_deal_tracking.sql, na mesma sessão. É IDEMPOTENTE.
--
-- O que adiciona:
--   • profiles.seller_level        — nível do vendedor (Iniciante/Junior/Master/
--     Senior/Sênior Plus), definido só pelo admin, usado para calcular comissão.
--   • conversations.client_type    — 'novo' ou 'reativacao'
--   • conversations.installment_plan — quantas parcelas esse cliente tem (2, 3 ou 4)
--   • conversations.commission_eligible — true quando TODAS as parcelas foram pagas
--   • sale_installments            — uma linha por parcela (1..N) de cada venda,
--     com a data em que foi paga (paid_at NULL = ainda não paga)
--   • app_settings: 'monthly_goal_plans' (meta de planos/mês) e 'commission_table'
--     (a tabela de comissão por nível x faixa de adimplência, em JSON, editável
--     pelo admin na tela de Equipe — sem precisar mexer em código)
--
-- Como funciona sozinho:
--   Quando um card entra numa coluna "Ganha" pela primeira vez, o gatilho já
--   existente (set_conversation_deal_timestamps) marca client_type='novo' e
--   installment_plan=4 por padrão, e um novo gatilho cria as 4 parcelas em
--   aberto. O vendedor troca para "reativação" (2/3/4 parcelas) e marca cada
--   parcela paga direto no card — sem precisar de coluna nova no Kanban.
-- =============================================================================

-- 1. Nível do vendedor (só o admin edita — já existe policy "Admins can update all profiles")
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS seller_level text NOT NULL DEFAULT 'Iniciante';

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_seller_level_check
    CHECK (seller_level IN ('Iniciante','Junior','Master','Senior','Sênior Plus'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Modelo de parcelamento da venda ------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS client_type text,
  ADD COLUMN IF NOT EXISTS installment_plan smallint,
  ADD COLUMN IF NOT EXISTS commission_eligible boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_client_type_check
    CHECK (client_type IS NULL OR client_type IN ('novo','reativacao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_installment_plan_check
    CHECK (installment_plan IS NULL OR installment_plan IN (2,3,4));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Parcelas (uma linha por parcela de cada venda) ---------------------------
CREATE TABLE IF NOT EXISTS public.sale_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installment_no smallint NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, installment_no)
);
CREATE INDEX IF NOT EXISTS idx_sale_installments_conv ON public.sale_installments (conversation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_installments TO authenticated;
GRANT ALL ON public.sale_installments TO service_role;
ALTER TABLE public.sale_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_sale_installments" ON public.sale_installments;
CREATE POLICY "own_sale_installments" ON public.sale_installments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Estende o gatilho existente: 1ª vez que a venda vira "Ganha", já entra
--    como "novo" (4 parcelas) por padrão — o vendedor troca depois se for
--    reativação. (Recria a função inteira; o resto do comportamento é igual
--    ao da migration anterior.)
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
      IF NEW.client_type IS NULL THEN
        NEW.client_type := 'novo';
        NEW.installment_plan := 4;
      END IF;
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

-- 5. Depois que o UPDATE acima aplica (installment_plan já definido), cria as
--    parcelas em aberto — só na primeira vez (não recria se já existem).
CREATE OR REPLACE FUNCTION public.create_default_installments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.installment_plan IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sale_installments WHERE conversation_id = NEW.id) THEN
    INSERT INTO public.sale_installments (conversation_id, user_id, installment_no)
    SELECT NEW.id, NEW.user_id, gs FROM generate_series(1, NEW.installment_plan) AS gs;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_conversation_installments ON public.conversations;
CREATE TRIGGER on_conversation_installments
  AFTER UPDATE ON public.conversations
  FOR EACH ROW
  WHEN (NEW.installment_plan IS NOT NULL)
  EXECUTE FUNCTION public.create_default_installments();

-- 6. Recalcula commission_eligible sempre que uma parcela é marcada/desmarcada
CREATE OR REPLACE FUNCTION public.refresh_commission_eligible()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  conv_id uuid := COALESCE(NEW.conversation_id, OLD.conversation_id);
  plan smallint;
  paid_count integer;
BEGIN
  SELECT installment_plan INTO plan FROM public.conversations WHERE id = conv_id;
  SELECT count(*) INTO paid_count FROM public.sale_installments
    WHERE conversation_id = conv_id AND paid_at IS NOT NULL;
  UPDATE public.conversations
    SET commission_eligible = (plan IS NOT NULL AND paid_count >= plan)
    WHERE id = conv_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS on_sale_installment_change ON public.sale_installments;
CREATE TRIGGER on_sale_installment_change
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_installments
  FOR EACH ROW EXECUTE FUNCTION public.refresh_commission_eligible();

-- 7. Backfill: vendas já ganhas antes desta migration recebem 4 parcelas em
--    aberto por padrão (o vendedor ajusta manualmente se algum caso for
--    reativação, e marca as que já foram pagas).
UPDATE public.conversations
  SET client_type = 'novo', installment_plan = 4
  WHERE closed_at IS NOT NULL AND client_type IS NULL;

INSERT INTO public.sale_installments (conversation_id, user_id, installment_no)
SELECT c.id, c.user_id, gs
FROM public.conversations c, generate_series(1, c.installment_plan) AS gs
WHERE c.closed_at IS NOT NULL AND c.installment_plan IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.sale_installments si WHERE si.conversation_id = c.id)
ON CONFLICT DO NOTHING;

-- 8. Configurações globais: meta mensal e tabela de comissão (editáveis pelo
--    admin na tela de Equipe, sem precisar mexer em SQL ou redeploy).
INSERT INTO public.app_settings (key, value) VALUES
  ('monthly_goal_plans', '15')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES
  ('commission_table', '{
    "valorAdesao": 50,
    "faixas": ["70% a 80%", "80,1% a 90%", "90,1% a 100%"],
    "niveis": [
      {"nome": "Iniciante",   "quantPlanos": 8,  "valores": [40, 0,   0]},
      {"nome": "Junior",      "quantPlanos": 12, "valores": [55, 90,  180]},
      {"nome": "Master",      "quantPlanos": 15, "valores": [65, 100, 200]},
      {"nome": "Senior",      "quantPlanos": 18, "valores": [75, 110, 220]},
      {"nome": "Sênior Plus", "quantPlanos": 20, "valores": [80, 120, 250]}
    ]
  }')
ON CONFLICT (key) DO NOTHING;

-- 9. app_settings é admin-only (guarda token da Uazapi etc.) — mas a meta mensal e
--    a tabela de comissão precisam ser lidas por QUALQUER vendedor (é a comissão
--    dele). Esta função devolve só essas duas chaves, nunca a tabela inteira.
CREATE OR REPLACE FUNCTION public.get_team_settings()
RETURNS TABLE(key text, value text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT key, value FROM public.app_settings WHERE key IN ('monthly_goal_plans', 'commission_table');
$$;
REVOKE ALL ON FUNCTION public.get_team_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_settings() TO authenticated;
