-- =============================================================================
-- 0037 — KAT-05 audit-guard trigger fix v2.
--
-- 0036 used `current_user = 'postgres'` to detect service-role direct
-- connections, but inside a SECURITY DEFINER function current_user is ALWAYS
-- the function owner ('postgres'), so every caller appeared to be service_role
-- and the FARMER INSERT clamping path (KAT-05 D) never fired.
--
-- Correct approach:
--   1. request.jwt.claims::jsonb->>'role' = 'service_role'  → PostgREST path
--   2. v_jwt_role IS NULL AND session_user = 'postgres'     → direct :5432
--      worker connection (workers never set JWT claims; tests always set them
--      so this branch fires ONLY for real worker connections)
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
    -- NB: SECURITY DEFINER → current_user = function owner ('postgres') always.
    -- Do NOT use current_user to distinguish caller roles.
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
