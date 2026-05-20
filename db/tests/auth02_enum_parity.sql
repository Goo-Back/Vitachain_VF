-- =============================================================================
-- AUTH-02 — Postgres user_role enum is exactly {FARMER, RESTAURANT, CITIZEN, ADMIN}.
-- Catches a future migration that silently widens the enum.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare
    expected text[] := array['ADMIN','CITIZEN','FARMER','RESTAURANT'];
    actual   text[];
begin
    select array_agg(enumlabel order by enumlabel)
      into actual
      from pg_enum
     where enumtypid = 'public.user_role'::regtype;
    if actual is distinct from expected then
        raise exception 'user_role enum drift: expected %, got %', expected, actual;
    end if;
    raise notice 'OK user_role parity';
end$$;
