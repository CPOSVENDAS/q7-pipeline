-- Biblioteca pessoal de áudios/imagens/textos prontos para a Transmissão.
-- Cada vendedor monta a própria (mesmo padrão de isolamento por user_id
-- usado no resto do sistema) e usa na tela de Transmissão em vez de
-- anexar o mesmo arquivo toda vez.

CREATE TABLE IF NOT EXISTS public.media_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'audio', 'text')),
  title text NOT NULL,
  file_url text,
  text_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_library_content_matches_kind CHECK (
    (kind IN ('image', 'audio') AND file_url IS NOT NULL)
    OR (kind = 'text' AND text_content IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS media_library_user_id_idx ON public.media_library(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_library TO authenticated;

ALTER TABLE public.media_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_media_library ON public.media_library;
CREATE POLICY own_media_library ON public.media_library
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
