"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

import { toIntlLocale } from "@/lib/intlLocale";

import {
  pairDevice,
  rotateDeviceKey,
  unlinkDevice,
  unpairDevice,
  type Device,
  type PairedDevice,
} from "./actions";

interface Props {
  parcelId: string;
  parcelName: string;
  initialDevices: Device[];
  canPair: boolean;
}

/**
 * KAT-02 — pairing UX on the parcel detail page.
 *
 * State machine (top-level dialog):
 *
 *   closed ──open()─→ form ──submit()─→ revealed (plaintext) ──confirm()─→ closed
 *
 * The plaintext key is only ever held in component state. We never log it,
 * never persist it client-side, and never include it in revalidatePath
 * redirects. The confirm checkbox is required before the modal can close
 * after a successful pair / rotate.
 */
export function DevicesSection({
  parcelId,
  parcelName,
  initialDevices,
  canPair,
}: Props) {
  const t = useTranslations("farmer.parcels.detail.devices");
  const router = useRouter();
  const [devices] = useState(initialDevices);
  const [pairOpen, setPairOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<Device | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<Device | null>(null);

  return (
    <section className="mt-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        {canPair && (
          <button
            type="button"
            onClick={() => setPairOpen(true)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            {t("associate")}
          </button>
        )}
      </div>

      {!canPair ? (
        <UnverifiedNotice />
      ) : devices.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {devices.map((d) => (
            <DeviceCard
              key={d.id}
              parcelId={parcelId}
              device={d}
              onRotate={() => setRotateTarget(d)}
              onUnlink={() => setUnlinkTarget(d)}
              onAfterUnpair={() => router.refresh()}
            />
          ))}
        </ul>
      )}

      {pairOpen && (
        <PairDeviceDialog
          parcelId={parcelId}
          onClose={(paired) => {
            setPairOpen(false);
            if (paired) router.refresh();
          }}
        />
      )}

      {rotateTarget && (
        <RotateKeyDialog
          parcelId={parcelId}
          device={rotateTarget}
          onClose={(rotated) => {
            setRotateTarget(null);
            if (rotated) router.refresh();
          }}
        />
      )}

      {unlinkTarget && (
        <UnlinkDeviceDialog
          parcelId={parcelId}
          parcelName={parcelName}
          device={unlinkTarget}
          onClose={(unlinked) => {
            setUnlinkTarget(null);
            if (unlinked) router.refresh();
          }}
        />
      )}
    </section>
  );
}

function UnverifiedNotice() {
  const t = useTranslations("farmer.parcels.detail.devices");
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">{t("unverifiedTitle")}</p>
      <p className="mt-1">
        {t("unverifiedBody")}
      </p>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("farmer.parcels.detail.devices");
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-600 shadow-sm">
      <p>{t("emptyTitle")}</p>
      <p className="mt-1 text-neutral-500">
        {t("emptyBody")}
      </p>
    </div>
  );
}

function DeviceCard({
  parcelId,
  device,
  onRotate,
  onUnlink,
  onAfterUnpair,
}: {
  parcelId: string;
  device: Device;
  onRotate: () => void;
  onUnlink: () => void;
  onAfterUnpair: () => void;
}) {
  const t = useTranslations("farmer.parcels.detail.devices");
  const intlLocale = toIntlLocale(useLocale());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // KAT-12 — the PENDING-only fast path: a device that has never sent
  // telemetry can still be hard-deleted via the KAT-02 unpair endpoint
  // (which 409s the moment telemetry exists). Anything past PENDING uses
  // the KAT-12 unlink flow that preserves history.
  const canHardUnpair = device.status === "PENDING";

  function handleHardUnpair() {
    if (
      !confirm(t("confirmHardUnpair", { deviceId: device.device_id }))
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await unpairDevice(parcelId, device.id);
      if (!r.ok) {
        setError(unpairErrorCopy(r.error, t));
        return;
      }
      onAfterUnpair();
    });
  }

  const isUnlinked = device.status === "UNLINKED";

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-neutral-900">
            {device.device_id}
          </p>
          <p className="mt-0.5 font-mono text-xs text-neutral-500">
            {t("keyLabel", { last4: device.api_key_last4 })}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {t("addedOn", {
              date: new Date(device.created_at).toLocaleDateString(intlLocale),
              lastSeen: device.last_seen
                ? t("lastPing", { date: new Date(device.last_seen).toLocaleString(intlLocale) })
                : t("noTelemetry"),
            })}
          </p>
        </div>
        <StatusBadge status={device.status} />
      </div>

      {!isUnlinked && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            onClick={onRotate}
            disabled={pending}
            className="text-emerald-700 hover:underline disabled:opacity-50"
          >
            {t("regenerateKey")}
          </button>
          <span className="text-neutral-300">·</span>
          {canHardUnpair ? (
            <button
              type="button"
              onClick={handleHardUnpair}
              disabled={pending}
              className="text-red-700 hover:underline disabled:opacity-50"
              title={t("deleteTitle")}
            >
              {pending ? t("deleting") : t("delete")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onUnlink}
              disabled={pending}
              className="text-red-700 hover:underline disabled:opacity-50"
              title={t("detachTitle")}
            >
              {t("detach")}
            </button>
          )}
        </div>
      )}

      {isUnlinked && (
        <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          {t("unlinkedNotice")}
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: Device["status"] }) {
  const t = useTranslations("farmer.parcels.detail.devices.status");
  const clsMap: Record<Device["status"], string> = {
    PENDING: "bg-amber-50 text-amber-800 border-amber-200",
    ACTIVE: "bg-emerald-50 text-emerald-800 border-emerald-200",
    OFFLINE: "bg-red-50 text-red-800 border-red-200",
    UNLINKED: "bg-neutral-100 text-neutral-700 border-neutral-200",
  };
  const labelKeyMap: Record<Device["status"], string> = {
    PENDING: "pending",
    ACTIVE: "active",
    OFFLINE: "offline",
    UNLINKED: "unlinked",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${clsMap[status]}`}
    >
      {t(labelKeyMap[status])}
    </span>
  );
}

type Translator = (key: string, values?: Record<string, string | number | Date>) => string;

function pairErrorCopy(detail: string, t: Translator): string {
  switch (detail) {
    case "device_already_paired":
      return t("errors.pair.device_already_paired");
    case "parcel_not_found":
      return t("errors.pair.parcel_not_found");
    case "verification_required":
      return t("errors.pair.verification_required");
    case "role_not_allowed":
      return t("errors.pair.role_not_allowed");
    default:
      return t("errors.pair.generic", { detail });
  }
}

function unpairErrorCopy(detail: string, t: Translator): string {
  switch (detail) {
    case "device_has_telemetry_use_unlink_in_kat12":
      return t("errors.unpair.device_has_telemetry");
    case "device_not_found":
      return t("errors.unpair.device_not_found");
    default:
      return t("errors.unpair.generic", { detail });
  }
}

// ── Pairing dialog ──────────────────────────────────────────────────────────

function PairDeviceDialog({
  parcelId,
  onClose,
}: {
  parcelId: string;
  onClose: (paired: boolean) => void;
}) {
  const t = useTranslations("farmer.parcels.detail.devices");
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<PairedDevice | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await pairDevice(parcelId, deviceId);
      if (!r.ok) {
        setError(pairErrorCopy(r.error, t));
        return;
      }
      setPaired(r.device);
    });
  }

  return (
    <ModalShell onBackdrop={() => paired || pending ? null : onClose(false)}>
      {!paired ? (
        <PairForm
          deviceId={deviceId}
          onChange={setDeviceId}
          onSubmit={submit}
          onCancel={() => onClose(false)}
          pending={pending}
          error={error}
        />
      ) : (
        <PlaintextReveal
          plaintext={paired.api_key}
          deviceId={paired.device_id}
          onClose={() => onClose(true)}
        />
      )}
    </ModalShell>
  );
}

function PairForm({
  deviceId,
  onChange,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  deviceId: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const t = useTranslations("farmer.parcels.detail.devices.pairDialog");
  const valid = /^ESP-KAT-\d{3}$/.test(deviceId.trim());
  return (
    <>
      <h3 className="mb-3 text-lg font-semibold">{t("title")}</h3>
      <label className="mb-1 block text-sm font-medium" htmlFor="device_id">
        {t("idLabel")}
      </label>
      <input
        id="device_id"
        value={deviceId}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder={t("idPlaceholder")}
        className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <p className="mb-3 text-xs text-neutral-500">
        {t("idHelp", { format: "ESP-KAT-NNN" })}
      </p>
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || !valid}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </div>
    </>
  );
}

function PlaintextReveal({
  plaintext,
  deviceId,
  onClose,
}: {
  plaintext: string;
  deviceId: string;
  onClose: () => void;
}) {
  const t = useTranslations("farmer.parcels.detail.devices.reveal");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (e.g. http context); user can copy manually.
    }
  }

  return (
    <>
      <h3 className="mb-2 text-lg font-semibold">
        {t("title", { deviceId })}
      </h3>
      <p className="mb-3 text-sm text-neutral-600">
        {t("body")}{" "}
        <strong className="text-red-700">
          {t("warning")}
        </strong>
      </p>
      <div className="mb-2 break-all rounded-md border border-neutral-300 bg-neutral-50 px-3 py-3 font-mono text-sm">
        {plaintext}
      </div>
      <button
        type="button"
        onClick={copy}
        className="mb-4 text-sm text-emerald-700 hover:underline"
      >
        {copied ? t("copied") : t("copy")}
      </button>
      <label className="mb-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <span>
          {t("confirmCheckbox")}
        </span>
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={!confirmed}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {t("finish")}
        </button>
      </div>
    </>
  );
}

// ── Rotate-key dialog ───────────────────────────────────────────────────────

function RotateKeyDialog({
  parcelId,
  device,
  onClose,
}: {
  parcelId: string;
  device: Device;
  onClose: (rotated: boolean) => void;
}) {
  const t = useTranslations("farmer.parcels.detail.devices");
  const tRotate = useTranslations("farmer.parcels.detail.devices.rotateDialog");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<PairedDevice | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await rotateDeviceKey(parcelId, device.id);
      if (!r.ok) {
        setError(pairErrorCopy(r.error, t));
        return;
      }
      setRotated(r.device);
    });
  }

  return (
    <ModalShell onBackdrop={() => rotated || pending ? null : onClose(false)}>
      {!rotated ? (
        <>
          <h3 className="mb-2 text-lg font-semibold">
            {tRotate("title")}
          </h3>
          <p className="mb-3 text-sm text-neutral-600">
            {tRotate("body", { deviceId: device.device_id })}{" "}
            <strong>{tRotate("warning")}</strong>{" "}
            {tRotate("note")}
          </p>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <label className="mb-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1"
            />
            <span>
              {tRotate("ack")}
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={pending}
              className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
            >
              {tRotate("cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !acknowledged}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? tRotate("submitting") : tRotate("submit")}
            </button>
          </div>
        </>
      ) : (
        <PlaintextReveal
          plaintext={rotated.api_key}
          deviceId={rotated.device_id}
          onClose={() => onClose(true)}
        />
      )}
    </ModalShell>
  );
}

// ── KAT-12 — Unlink dialog ──────────────────────────────────────────────────

function unlinkErrorCopy(detail: string, t: Translator): string {
  switch (detail) {
    case "device_not_found":
      return t("errors.unlink.device_not_found");
    case "device_already_unlinked":
      return t("errors.unlink.device_already_unlinked");
    case "role_not_allowed":
      return t("errors.unlink.role_not_allowed");
    default:
      return t("errors.unlink.generic", { detail });
  }
}

function UnlinkDeviceDialog({
  parcelId,
  parcelName,
  device,
  onClose,
}: {
  parcelId: string;
  parcelName: string;
  device: Device;
  onClose: (unlinked: boolean) => void;
}) {
  const t = useTranslations("farmer.parcels.detail.devices");
  const tUnlink = useTranslations("farmer.parcels.detail.devices.unlinkDialog");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await unlinkDevice(parcelId, device.id);
      if (!r.ok) {
        setError(unlinkErrorCopy(r.error, t));
        return;
      }
      onClose(true);
    });
  }

  return (
    <ModalShell onBackdrop={() => (pending ? null : onClose(false))}>
      <h3 className="mb-2 text-lg font-semibold">
        {tUnlink("title", { deviceId: device.device_id })}
      </h3>
      <p className="mb-3 text-sm text-neutral-600">
        {tUnlink("body", { parcelName })}
      </p>
      <ul className="mb-3 list-disc space-y-1 ps-5 text-sm text-neutral-600">
        <li>
          {tUnlink.rich("bullet1", {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </li>
        <li>
          {tUnlink("bullet2")}
        </li>
        <li>
          {tUnlink("bullet3", { deviceId: device.device_id })}
        </li>
      </ul>
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <label className="mb-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-1"
        />
        <span>
          {tUnlink("ack")}
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onClose(false)}
          disabled={pending}
          className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          {tUnlink("cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !acknowledged}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? tUnlink("submitting") : tUnlink("submit")}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  onBackdrop,
  children,
}: {
  onBackdrop: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdrop();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        {children}
      </div>
    </div>
  );
}
