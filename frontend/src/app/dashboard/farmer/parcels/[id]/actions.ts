"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * KAT-02 — server actions wrapping the FastAPI device endpoints.
 *
 * Same pattern as ../actions.ts: the browser never sees the raw bearer
 * token. The Supabase session cookie is read server-side, and the
 * access_token is forwarded to FastAPI as `Authorization: Bearer …`.
 *
 * The pairing endpoint is the ONLY place the plaintext `vk_…` API key
 * crosses the wire. The response is returned to the client (modal) and
 * never logged.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Device = {
  id: string;
  device_id: string;
  parcel_id: string;
  farmer_id: string;
  api_key_last4: string;
  status: "PENDING" | "ACTIVE" | "OFFLINE" | "UNLINKED";
  last_seen: string | null;
  created_at: string;
  updated_at: string;
};

export type PairedDevice = Device & {
  api_key: string; // plaintext — shown ONCE
};

export type PairDeviceResult =
  | { ok: true; device: PairedDevice }
  | { ok: false; error: string };

async function _authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("not_authenticated");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}/api/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

export async function fetchParcelDevices(parcelId: string): Promise<Device[]> {
  const r = await _authedFetch(`/katara/parcels/${parcelId}/devices`);
  if (!r.ok) {
    if (r.status === 401 || r.status === 403 || r.status === 404) return [];
    throw new Error(`fetch_devices_failed:${r.status}`);
  }
  return (await r.json()) as Device[];
}

export async function pairDevice(
  parcelId: string,
  deviceId: string,
): Promise<PairDeviceResult> {
  const r = await _authedFetch(`/katara/parcels/${parcelId}/devices`, {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId.trim() }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }
  const device = (await r.json()) as PairedDevice;
  revalidatePath(`/dashboard/farmer/parcels/${parcelId}`);
  return { ok: true, device };
}

export async function unpairDevice(
  parcelId: string,
  deviceRowId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await _authedFetch(
    `/katara/parcels/${parcelId}/devices/${deviceRowId}`,
    { method: "DELETE" },
  );
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }
  revalidatePath(`/dashboard/farmer/parcels/${parcelId}`);
  return { ok: true };
}

export type UnlinkedDevice = {
  id: string;
  device_id: string;
  parcel_id: string;
  status: "UNLINKED";
};

export type UnlinkDeviceResult =
  | { ok: true; device: UnlinkedDevice }
  | { ok: false; error: string };

/**
 * KAT-12 — soft-detach a device from its parcel.
 *
 * The endpoint flips `status` to UNLINKED. The api-key stops authenticating
 * on the next ESP32 transmission (the verifier filters UNLINKED rows). The
 * old row stays in place so historical telemetry remains queryable under
 * the original parcel (KAT-13). To pair the same physical device on a
 * different parcel, the farmer calls {@link pairDevice} with the same
 * literal device_id on the new parcel.
 */
export async function unlinkDevice(
  parcelId: string,
  deviceUuid: string,
): Promise<UnlinkDeviceResult> {
  const r = await _authedFetch(`/katara/devices/${deviceUuid}/unlink`, {
    method: "POST",
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }
  const device = (await r.json()) as UnlinkedDevice;
  revalidatePath(`/dashboard/farmer/parcels/${parcelId}`);
  return { ok: true, device };
}

export async function rotateDeviceKey(
  parcelId: string,
  deviceRowId: string,
): Promise<PairDeviceResult> {
  const r = await _authedFetch(
    `/katara/parcels/${parcelId}/devices/${deviceRowId}/rotate-key`,
    { method: "POST" },
  );
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: unknown };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : `request_failed:${r.status}`;
    return { ok: false, error: detail };
  }
  const device = (await r.json()) as PairedDevice;
  revalidatePath(`/dashboard/farmer/parcels/${parcelId}`);
  return { ok: true, device };
}
