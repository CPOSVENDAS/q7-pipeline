-- Lembretes de tarefa (lista interna, sem notificação push)
-- Aditiva: não altera nenhuma migration anterior.

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_user_due_idx on public.reminders(user_id, due_at);
create index if not exists reminders_conversation_id_idx on public.reminders(conversation_id);
grant select, insert, update, delete on public.reminders to authenticated;
alter table public.reminders enable row level security;
drop policy if exists own_reminders on public.reminders;
create policy own_reminders on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
