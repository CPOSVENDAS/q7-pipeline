-- =============================================================================
-- Q7 Pipeline — schema inicial completo
-- =============================================================================
-- Esta é a ÚNICA fonte de verdade do banco. Não existe outro arquivo de schema.
--
-- Pode ser aplicado de 3 formas (todas equivalentes):
--   a) MCP Supabase:  apply_migration(name: "q7_init", query: <conteúdo deste arquivo>)
--   b) Supabase CLI:  supabase db push
--   c) Manual:        colar o arquivo inteiro no SQL Editor do painel e Run
--
-- É IDEMPOTENTE: pode ser executado várias vezes sem erro. Se você viu um erro
-- no meio, corrija a causa e rode de novo — não precisa recriar o projeto.
-- =============================================================================


-- =============================================================================
-- 0. Extensões
-- =============================================================================
-- Nenhuma delas é fatal: se o Postgres recusar (falta de permissão), o script
-- segue e avisa. pg_cron e pg_net só são necessários para os follow-ups
-- automáticos (passo do cron) — o resto do CRM funciona sem eles.

DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[q7] pgcrypto: % (ignorado — gen_random_uuid é nativo no PG13+)', SQLERRM;
END $$;

DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
  EXECUTE 'GRANT USAGE ON SCHEMA cron TO postgres';
  EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[q7] pg_cron nao habilitado: %. Ative em Database > Extensions no painel e rode o cron depois.', SQLERRM;
END $$;

DO $$
BEGIN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions';
EXCEPTION WHEN OTHERS THEN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[q7] pg_net nao habilitado: %. Ative em Database > Extensions no painel.', SQLERRM;
  END;
END $$;

-- Schema privado para funções security definer
CREATE SCHEMA IF NOT EXISTS private;

-- Enum de roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- 1. Tabelas
-- =============================================================================

-- profiles ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  approved boolean NOT NULL DEFAULT true,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- user_roles -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- whatsapp_instances -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  profile_name text,
  instance_token text,
  server_url text,
  status text NOT NULL DEFAULT 'disconnected',
  last_disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_instances TO authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

-- pipeline_stages --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pipeline_stages_user_pos_idx ON public.pipeline_stages (user_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
GRANT ALL ON public.pipeline_stages TO service_role;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

-- conversations ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  contact_phone text NOT NULL,
  contact_name text,
  ai_enabled boolean NOT NULL DEFAULT true,
  human_takeover_at timestamptz,
  inactivity_followup_at timestamptz,
  auto_followup_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_phone)
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_last ON public.conversations (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_stage_idx ON public.conversations (user_id, stage_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- messages ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender text NOT NULL CHECK (sender IN ('contact','ai','human')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages (conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- agent_configs (uma linha por usuário) ----------------------------------
CREATE TABLE IF NOT EXISTS public.agent_configs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  groq_api_key text,
  groq_model text NOT NULL DEFAULT 'llama-3.3-70b-versatile',
  system_prompt text NOT NULL DEFAULT 'Você é um assistente de atendimento simpático e objetivo. Quando receber [áudio], [imagem], [vídeo] ou [documento], diga que ainda não consegue ouvir ou ver o conteúdo e peça para o cliente resumir por texto.',
  enabled boolean NOT NULL DEFAULT false,
  followup_inactivity_minutes integer,
  followup_max_per_conversation integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_configs TO authenticated;
GRANT ALL ON public.agent_configs TO service_role;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;

-- followups --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  kind text NOT NULL DEFAULT 'manual',
  text_override text,
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followups_pending_idx ON public.followups (status, send_at);
CREATE INDEX IF NOT EXISTS followups_conv_idx ON public.followups (conversation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.followups TO authenticated;
GRANT ALL ON public.followups TO service_role;
ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;

-- app_settings (global, admin-only) --------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 2. Função has_role (usada pelas policies de admin)
-- =============================================================================
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Cópia pública (compatibilidade com código legado)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

REVOKE EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;


-- =============================================================================
-- 3. Policies (RLS) — cada usuário só enxerga os próprios dados
-- =============================================================================
-- Todas com DROP antes: rodar este arquivo de novo não gera erro de duplicata.

-- profiles
DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'));

-- user_roles
DROP POLICY IF EXISTS "Users can view own roles"     ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete user roles" ON public.user_roles;

CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can insert user roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update user roles" ON public.user_roles
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete user roles" ON public.user_roles
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'));

-- whatsapp_instances
DROP POLICY IF EXISTS "Users can manage own instances"        ON public.whatsapp_instances;
DROP POLICY IF EXISTS "Admins can view all whatsapp instances" ON public.whatsapp_instances;

CREATE POLICY "Users can manage own instances" ON public.whatsapp_instances
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all whatsapp instances" ON public.whatsapp_instances
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'));

-- pipeline_stages
DROP POLICY IF EXISTS "Users manage their own stages" ON public.pipeline_stages;
CREATE POLICY "Users manage their own stages" ON public.pipeline_stages
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- conversations
DROP POLICY IF EXISTS "own_conversations" ON public.conversations;
CREATE POLICY "own_conversations" ON public.conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- messages
DROP POLICY IF EXISTS "own_messages" ON public.messages;
CREATE POLICY "own_messages" ON public.messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- agent_configs
DROP POLICY IF EXISTS "own_agent_config" ON public.agent_configs;
CREATE POLICY "own_agent_config" ON public.agent_configs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- followups
DROP POLICY IF EXISTS "Users manage their own followups" ON public.followups;
CREATE POLICY "Users manage their own followups" ON public.followups
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- app_settings (admin-only)
DROP POLICY IF EXISTS "Admins can view app_settings"   ON public.app_settings;
DROP POLICY IF EXISTS "Admins can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can delete app_settings" ON public.app_settings;

CREATE POLICY "Admins can view app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert app_settings" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete app_settings" ON public.app_settings
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'));


-- =============================================================================
-- 4. Funções auxiliares e onboarding automático
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.seed_pipeline_stages(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE user_id = _user_id) THEN
    INSERT INTO public.pipeline_stages (user_id, name, position, color) VALUES
      (_user_id, 'Novo Lead',     0, '#3FB8BE'),
      (_user_id, 'Em Negociação', 1, '#F59E0B'),
      (_user_id, 'Fechado',       2, '#10B981');
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seed_pipeline_stages(uuid) FROM PUBLIC, anon, authenticated;

-- Dispara ao criar usuário em auth.users:
--   • cria o profile
--   • o PRIMEIRO usuário vira admin; os demais viram 'user'
--   • cria os 3 estágios iniciais do funil
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE admin_count integer;
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');

  SELECT count(*) INTO admin_count FROM public.user_roles WHERE role = 'admin';
  IF admin_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.seed_pipeline_stages(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- 5. Triggers de updated_at
-- =============================================================================
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_instances_updated_at ON public.whatsapp_instances;
CREATE TRIGGER update_whatsapp_instances_updated_at BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_pipeline_stages_updated_at ON public.pipeline_stages;
CREATE TRIGGER update_pipeline_stages_updated_at BEFORE UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_configs_updated_at ON public.agent_configs;
CREATE TRIGGER update_agent_configs_updated_at BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_followups_updated_at ON public.followups;
CREATE TRIGGER update_followups_updated_at BEFORE UPDATE ON public.followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =============================================================================
-- 6. Realtime (atualização ao vivo das conversas / kanban)
-- =============================================================================
-- Guardado: adicionar uma tabela que já está na publicação daria erro.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations','messages','followups','pipeline_stages'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[q7] Realtime nao configurado: %. O CRM funciona, mas sem atualizacao ao vivo.', SQLERRM;
END $$;
