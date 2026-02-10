-- Always-on class chat persistence and access controls.

create table if not exists class_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  is_pinned boolean not null default false,
  archived_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists class_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references class_chat_sessions(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_kind text not null check (author_kind in ('student', 'teacher', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  safety text,
  provider text,
  model text,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists class_chat_sessions_class_owner_last_message_idx
  on class_chat_sessions(class_id, owner_user_id, last_message_at desc);

create index if not exists class_chat_messages_session_created_at_idx
  on class_chat_messages(session_id, created_at asc);

create index if not exists class_chat_messages_class_created_at_idx
  on class_chat_messages(class_id, created_at desc);

alter table class_chat_sessions enable row level security;
alter table class_chat_messages enable row level security;

drop trigger if exists class_chat_sessions_set_updated_at on class_chat_sessions;
create trigger class_chat_sessions_set_updated_at
before update on class_chat_sessions
for each row
execute function set_updated_at();

create policy class_chat_sessions_select_member
on class_chat_sessions for select
using (
  auth.uid() = owner_user_id
  or exists (
    select 1 from classes c
    where c.id = class_chat_sessions.class_id
      and c.owner_id = auth.uid()
  )
  or exists (
    select 1 from enrollments e
    where e.class_id = class_chat_sessions.class_id
      and e.user_id = auth.uid()
      and e.role in ('teacher', 'ta')
  )
);

create policy class_chat_sessions_insert_member
on class_chat_sessions for insert
with check (
  auth.uid() = owner_user_id
  and (
    exists (
      select 1 from classes c
      where c.id = class_chat_sessions.class_id
        and c.owner_id = auth.uid()
    )
    or exists (
      select 1 from enrollments e
      where e.class_id = class_chat_sessions.class_id
        and e.user_id = auth.uid()
    )
  )
);

create policy class_chat_sessions_update_owner
on class_chat_sessions for update
using (auth.uid() = owner_user_id)
with check (auth.uid() = owner_user_id);

create policy class_chat_sessions_delete_owner
on class_chat_sessions for delete
using (auth.uid() = owner_user_id);

create policy class_chat_sessions_select_admin on class_chat_sessions for select
using (is_admin());

create policy class_chat_messages_select_member
on class_chat_messages for select
using (
  exists (
    select 1 from class_chat_sessions s
    where s.id = class_chat_messages.session_id
      and s.class_id = class_chat_messages.class_id
      and (
        s.owner_user_id = auth.uid()
        or exists (
          select 1 from classes c
          where c.id = s.class_id
            and c.owner_id = auth.uid()
        )
        or exists (
          select 1 from enrollments e
          where e.class_id = s.class_id
            and e.user_id = auth.uid()
            and e.role in ('teacher', 'ta')
        )
      )
  )
);

create policy class_chat_messages_insert_owner_thread
on class_chat_messages for insert
with check (
  exists (
    select 1 from class_chat_sessions s
    where s.id = class_chat_messages.session_id
      and s.class_id = class_chat_messages.class_id
      and s.owner_user_id = auth.uid()
  )
  and (
    (
      class_chat_messages.author_kind in ('student', 'teacher')
      and class_chat_messages.author_user_id = auth.uid()
    )
    or (
      class_chat_messages.author_kind = 'assistant'
      and class_chat_messages.author_user_id is null
    )
  )
);

create policy class_chat_messages_select_admin on class_chat_messages for select
using (is_admin());
