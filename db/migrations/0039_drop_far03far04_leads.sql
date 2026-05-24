-- =============================================================================
-- 0039 — DROP the FAR-03 / FAR-04 lead-contact model.
--
-- Rationale: FarMarket is being pivoted away from direct contact (lead form +
-- Brevo email to seller) toward a fully anonymised marketplace where VitaChain
-- acts as the logistics intermediary. Restaurants will place orders through a
-- cart flow (new FAR-03), and producers will receive anonymised order
-- notifications (new FAR-04). No phone, email, or address ever crosses
-- between the two parties.
--
-- This migration replaces 0034 (m2_farmarket_leads) and 0035 (lead-notify
-- trigger) which are removed from the migration set in the same change.
-- Everything is IF EXISTS / DROP TRIGGER IF EXISTS so the file is a no-op on
-- fresh setups where 0034/0035 were never applied, and a clean teardown on
-- existing dev DBs where they were.
-- =============================================================================

-- 1. Drop the NOTIFY trigger (FAR-04) before its parent table.
drop trigger if exists trg_far04_notify_lead_created on public.m2_farmarket_leads;

-- 2. Drop the trigger function.
drop function if exists public.m2_farmarket_notify_lead_created();

-- 3. Drop the leads table (cascades RLS policies, indexes, FKs).
drop table if exists public.m2_farmarket_leads cascade;

-- 4. Drop the enum that backed lead status.
drop type if exists public.m2_farmarket_lead_status;
