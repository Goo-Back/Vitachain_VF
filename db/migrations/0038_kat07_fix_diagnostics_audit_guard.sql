-- =============================================================================
-- 0038 — KAT-07 diagnostics audit-guard trigger fix.
--
-- Same bug as KAT-05 (fixed in 0037): m1_katara_diagnostics_audit_guard()
-- reads the non-existent GUC `request.jwt.claim.role` and checks
-- `current_user = 'service_role'` — both always NULL/false inside a
-- SECURITY DEFINER function (current_user = function owner = 'postgres').
--
-- Fix: same two-signal approach as 0037.
-- =============================================================================

create or replace function public.m1_katara_diagnostics_audit_guard()
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
        return new;
    end if;

    -- Non-service writers: clamp all audit columns.
    if tg_op = 'UPDATE' then
        new.status        := old.status;
        new.result_text   := old.result_text;
        new.error_detail  := old.error_detail;
        new.started_at    := old.started_at;
        new.completed_at  := old.completed_at;
        new.parcel_id     := old.parcel_id;
        new.farmer_id     := old.farmer_id;
        new.requested_at  := old.requested_at;
    elsif tg_op = 'INSERT' then
        new.status        := 'PENDING';
        new.result_text   := null;
        new.error_detail  := null;
        new.started_at    := null;
        new.completed_at  := null;
    end if;
    return new;
end;
$$;
