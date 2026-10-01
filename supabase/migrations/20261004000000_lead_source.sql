-- Origem do lead (catálogo pessoal, mesma filosofia de "tags"): de onde veio
-- o contato (indicação, panfleto, bairro, etc.), um campo por conversa,
-- refletido em Relatórios. Aditiva: não altera nenhuma migration anterior.

create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint lead_sources_user_name_unique unique (user_id, name)
);
create index if not exists lead_sources_user_id_idx on public.lead_sources(user_id);
grant select, insert, update, delete on public.lead_sources to authenticated;
alter table public.lead_sources enable row level security;
drop policy if exists own_lead_sources on public.lead_sources;
create policy own_lead_sources on public.lead_sources
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.conversations
  add column if not exists lead_source_id uuid references public.lead_sources(id) on delete set null;
create index if not exists conversations_lead_source_id_idx on public.conversations(lead_source_id);
