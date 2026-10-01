-- =============================================================================
-- CPOS Vendas — Listas de transmissão (mandar foto + áudio pra todo mundo de
-- uma coluna do Kanban, tipo lista de transmissão do WhatsApp)
-- =============================================================================
-- Migration ADITIVA — aplique DEPOIS de 20260929150000_opening_message_template.sql.
-- É IDEMPOTENTE.
--
-- O que adiciona:
--   • tabela `broadcasts` — um registro por disparo (coluna escolhida, foto,
--     áudio, legenda, contadores de progresso).
--   • tabela `broadcast_recipients` — uma linha por contato daquela coluna,
--     processada aos poucos pela função `run-broadcasts` (cron, a cada
--     minuto) com espaçamento entre envios — a Uazapi é WhatsApp não-oficial
--     e mandar tudo de uma vez é a principal causa de ban do número.
--   • bucket de Storage `broadcast-media` (público pra leitura, só o dono
--     escreve/apaga na própria pasta) — é onde a foto e o áudio ficam
--     hospedados pra Uazapi conseguir baixar pela URL.
-- =============================================================================

-- 1. broadcasts -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  stage_name text NOT NULL,
  caption text,
  image_url text,
  audio_url text,
  total_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','completed_with_errors','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcasts_user_idx ON public.broadcasts (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_broadcasts" ON public.broadcasts;
CREATE POLICY "own_broadcasts" ON public.broadcasts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. broadcast_recipients ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_queue_idx ON public.broadcast_recipients (status, created_at);
CREATE INDEX IF NOT EXISTS broadcast_recipients_broadcast_idx ON public.broadcast_recipients (broadcast_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT ALL ON public.broadcast_recipients TO service_role;
ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_broadcast_recipients" ON public.broadcast_recipients;
CREATE POLICY "own_broadcast_recipients" ON public.broadcast_recipients
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Storage: bucket público (leitura) pra foto/áudio da transmissão --------
INSERT INTO storage.buckets (id, name, public)
VALUES ('broadcast-media', 'broadcast-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "broadcast_media_read_public" ON storage.objects;
CREATE POLICY "broadcast_media_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'broadcast-media');

DROP POLICY IF EXISTS "broadcast_media_insert_own" ON storage.objects;
CREATE POLICY "broadcast_media_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'broadcast-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "broadcast_media_update_own" ON storage.objects;
CREATE POLICY "broadcast_media_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'broadcast-media' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "broadcast_media_delete_own" ON storage.objects;
CREATE POLICY "broadcast_media_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'broadcast-media' AND (storage.foldername(name))[1] = auth.uid()::text);
