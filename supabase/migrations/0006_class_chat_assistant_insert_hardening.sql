-- Prevent client-forged assistant chat messages in always-on class chat.
-- Assistant messages are now inserted by trusted server code using the service role.

drop policy if exists class_chat_messages_insert_owner_thread on class_chat_messages;

create policy class_chat_messages_insert_owner_thread
on class_chat_messages for insert
with check (
  exists (
    select 1 from class_chat_sessions s
    where s.id = class_chat_messages.session_id
      and s.class_id = class_chat_messages.class_id
      and s.owner_user_id = auth.uid()
  )
  and class_chat_messages.author_kind in ('student', 'teacher')
  and class_chat_messages.author_user_id = auth.uid()
);
