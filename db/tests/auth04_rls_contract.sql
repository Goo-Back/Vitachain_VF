-- =============================================================================
-- AUTH-04 — Structural RLS contract.
-- Asserts that:
--   (1) every relation in schema `public` has row level security enabled;
--   (2) every such relation has at least one policy attached;
--   (3) public.has_role() exists and is SECURITY DEFINER.
--
-- Service-role psql connection only (direct :5432). Wrapped in a txn that
-- ROLLBACKs so the live project ends in the same state it started.
-- =============================================================================

\set ON_ERROR_STOP on

begin;

-- (1) Every public.* table has RLS enabled.
do $$
declare
    offenders text;
begin
    select string_agg(c.relname, ', ' order by c.relname)
      into offenders
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity;

    if offenders is not null then
        raise exception
            'AUTH-04 contract violation: public table(s) without RLS: %',
            offenders
            using errcode = '42501';
    end if;
    raise notice 'OK (1) every public.* table has row level security enabled';
end$$;

-- (2) Every public.* table has at least one policy. RLS without policies is
-- deny-all — acceptable for an unused table but a smell for anything the app
-- reads or writes. Catch it early.
do $$
declare
    naked text;
begin
    select string_agg(c.relname, ', ' order by c.relname)
      into naked
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind  = 'r'
       and not exists (
           select 1 from pg_policies p
            where p.schemaname = n.nspname
              and p.tablename  = c.relname
       );

    if naked is not null then
        raise exception
            'AUTH-04 contract violation: public table(s) with RLS enabled but no policies: %',
            naked
            using errcode = '42501';
    end if;
    raise notice 'OK (2) every public.* table has at least one RLS policy';
end$$;

-- (3) public.has_role(user_role) exists and is SECURITY DEFINER.
do $$
declare
    found boolean;
begin
    select exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'has_role'
           and p.prosecdef = true
    ) into found;

    if not found then
        raise exception
            'AUTH-04 contract violation: public.has_role(user_role) is missing or not SECURITY DEFINER';
    end if;
    raise notice 'OK (3) public.has_role(user_role) exists and is SECURITY DEFINER';
end$$;

-- (4) The event trigger from migration 0009 is active.
do $$
declare
    found boolean;
begin
    select exists (
        select 1 from pg_event_trigger
         where evtname = 'trg_enforce_rls_on_public_tables'
           and evtenabled <> 'D'
    ) into found;

    if not found then
        raise exception
            'AUTH-04 contract violation: event trigger trg_enforce_rls_on_public_tables is missing or disabled';
    end if;
    raise notice 'OK (4) event trigger trg_enforce_rls_on_public_tables is active';
end$$;

rollback;
