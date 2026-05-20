-- =============================================================================
-- 0025 — M1 Katara: offline-detection audit column (KAT-11).
-- Story:  KAT-11 (docs/stories/KAT-11-offline-device-detection.md)
--
-- Adds last_offline_alert_at to m1_katara_devices so the offline-detection
-- worker can dedup emails on a 24h window (BR-K11-1, mirrors BR-K2).
--
-- NULL = "never alerted". Service-role write only — the worker is the sole
-- legitimate writer; the column has no farmer-facing surface. There is no
-- audit-guard trigger here because KAT-02's RLS policy
-- `katara_devices_update_own` already allows owner UPDATEs on the row in
-- general; rather than re-architect the device-table RLS to clamp two
-- columns, KAT-11 relies on the AUTH-07 RLS matrix's audit-column WRITE
-- contract: service-role writes both columns, and the pgTAP cell in
-- db/tests/auth07_business_rules.sql asserts service-role ↔ authenticated
-- behaviour for status='OFFLINE' + last_offline_alert_at.
--
-- No new index. The scan filter `status='ACTIVE' AND last_seen<now()-1h`
-- runs over <=50 MVD-scale rows; the existing farmer_id + primary-key
-- indexes are sufficient.
-- =============================================================================

alter table public.m1_katara_devices
    add column if not exists last_offline_alert_at timestamptz;

comment on column public.m1_katara_devices.last_offline_alert_at is
    'KAT-11: timestamp of the most recent offline-detection email sent for '
    'this device. NULL = never alerted. Service-role write only; 24h '
    'anti-spam window (BR-K11-1). Cleared back to NULL only on a post-MVD '
    'recovery flow (KAT-11 §10 note #2).';
