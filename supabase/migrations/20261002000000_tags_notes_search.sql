-- Tags, notas e busca (Conversas/Kanban)
-- Aditiva: não altera nenhuma migration anterior.

-- 1) Campo de notas livres na conversa (mesmo padrão de deal_value: coluna
--    simples em conversations, editável inline).
alter table public.conversations add column if not exists notes text;

-- 2) Catálogo pessoal de tags (opções fixas que o vendedor cadastra e
--    mantém, mesmo padrão de pipeline_stages: tabela por user_id, RLS own-only).
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  created_at timestamptz not null default now(),
  constraint tags_user_name_unique unique (user_id, name)
);
create index if not exists tags_user_id_idx on public.tags(user_id);
grant select, insert, update, delete on public.tags to authenticated;
alter table public.tags enable row level security;
drop policy if exists own_tags on public.tags;
create policy own_tags on public.tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Junção conversa <-> tag (user_id denormalizado para RLS simples, mesmo
--    padrão de sale_installments/broadcast_recipients).
create table if not exists public.conversation_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint conversation_tags_unique unique (conversation_id, tag_id)
);
create index if not exists conversation_tags_user_id_idx on public.conversation_tags(user_id);
create index if not exists conversation_tags_conversation_id_idx on public.conversation_tags(conversation_id);
create index if not exists conversation_tags_tag_id_idx on public.conversation_tags(tag_id);
grant select, insert, update, delete on public.conversation_tags to authenticated;
alter table public.conversation_tags enable row level security;
drop policy if exists own_conversation_tags on public.conversation_tags;
create policy own_conversation_tags on public.conversation_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
