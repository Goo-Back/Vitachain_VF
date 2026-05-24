-- =============================================================================
-- 0036 — KAT-05 audit-guard trigger fix.
--
-- Bug: m1_katara_thresholds_audit_guard() reads the non-existent GUC
-- `request.jwt.claim.role` (singular, dotted) and checks
-- `current_user = 'service_role'` — both are always NULL/false for direct
-- :5432 postgres connections (the pattern used by all workers and the test
-- suite). As a result the "service_role bypass" branch never fires, the
-- trigger treats every direct-connection UPDATE as an authenticated request,
-- and silently discards `last_alert_at` writes from the KAT-06 worker.
--
-- Fix: detect service_role via two reliable signals:
--   1. current_user = 'postgres' — direct :5432 DSN (workers + test suite)
--   2. request.jwt.claims::jsonb->>'role' = 'service_role' — PostgREST path
-- =============================================================================

create or replace function public.m1_katara_thresholds_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_jwt_role        text;
    v_is_service_role boolean;
begin
    -- Extract the role from the JWT claims blob (set by PostgREST or the test suite).
    -- NB: in a SECURITY DEFINER function current_user = function owner (postgres),
    -- so we CANNOT use current_user to distinguish caller roles. We rely on:
    --   1. request.jwt.claims->>'role' = 'service_role'  → PostgREST service-role path
    --                                                       OR test-suite mock
    --   2. v_jwt_role IS NULL AND session_user = 'postgres' → direct :5432 worker
    --      connection (workers never set JWT claims; tests always set them explicitly
    --      so this branch fires ONLY for real worker connections, not test scenarios)
    v_jwt_role := coalesce(
        nullif(current_setting('request.jwt.claims', true), ''),
        '{}'
    )::jsonb ->> 'role';

    v_is_service_role := (
        v_jwt_role = 'service_role'
        or (v_jwt_role is null and session_user = 'postgres')
    );

    if v_is_service_role then
        -- Workers (KAT-06) may freely write last_alert_at / last_alert_value.
        if tg_op = 'UPDATE' then
            new.updated_at := now();
        end if;
        return new;
    end if;

    -- Authenticated user path — clamp audit columns silently.
    if tg_op = 'INSERT' then
        new.last_alert_at    := null;
        new.last_alert_value := null;
        return new;
    elsif tg_op = 'UPDATE' then
        new.last_alert_at    := old.last_alert_at;
        new.last_alert_value := old.last_alert_value;
        new.created_at       := old.created_at;
        new.updated_at       := now();
        new.farmer_id        := old.farmer_id;
        new.parcel_id        := old.parcel_id;
        new.metric           := old.metric;
        return new;
    end if;
    return new;
end;
$$;
