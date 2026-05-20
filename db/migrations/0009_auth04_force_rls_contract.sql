-- =============================================================================
-- 0009 — Event trigger: refuse CREATE TABLE in `public` without RLS enabled.
-- Story:  AUTH-04 (docs/stories/AUTH-04-enable-rls-on-sensitive-tables.md)
--
-- The pgSQL regression test (db/tests/auth04_rls_contract.sql) and the CI
-- guard (scripts/verify-rls-enabled.sh) are the *first* lines of defence.
-- This event trigger is the *last*: it fires in-database, regardless of who
-- issued the DDL — psql session, migration runner, dashboard SQL editor.
-- If a future table lands without `enable row level security`, the
-- CREATE TABLE statement aborts at ddl_command_end.
--
-- Caveat — partition tables / `like` clones: the trigger checks
-- pg_class.relrowsecurity directly, which is the storage-level flag and is
-- NOT inherited by partitions or `create table … (like other)`. Documented
-- in docs/runbook.md §AUTH-04 RLS contract as the one corner case future
-- stories may need to revisit if partitioning is introduced.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.enforce_rls_on_public_tables()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    obj           record;
    schema_name   text;
    table_name    text;
begin
    for obj in
        select * from pg_event_trigger_ddl_commands()
         where command_tag = 'CREATE TABLE'
    loop
        -- object_identity looks like "public.parcels" (or "public.""odd name""").
        if obj.object_identity like 'public.%' then
            schema_name := split_part(obj.object_identity, '.', 1);
            table_name  := split_part(obj.object_identity, '.', 2);

            -- Strip optional quoting.
            table_name := trim(both '"' from table_name);

            if not exists (
                select 1
                  from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = schema_name
                   and c.relname = table_name
                   and c.relrowsecurity = true
            ) then
                raise exception
                    'AUTH-04: table %.% was created without row level security. '
                    'Add `alter table %.% enable row level security;` in the same '
                    'migration. See docs/runbook.md §AUTH-04 RLS contract.',
                    schema_name, table_name, schema_name, table_name
                    using errcode = '42501';
            end if;
        end if;
    end loop;
end;
$$;

drop event trigger if exists trg_enforce_rls_on_public_tables;
create event trigger trg_enforce_rls_on_public_tables
    on ddl_command_end
    when tag in ('CREATE TABLE')
    execute function public.enforce_rls_on_public_tables();
