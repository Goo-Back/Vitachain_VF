"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [devices] = useState(initialDevices);
  const [pairOpen, setPairOpen] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<Device | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<Device | null>(null);

  return (
    <section className="mt-2">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Capteurs ESP32</h2>
        {canPair && (
          <button
            type="button"
            onClick={() => setPairOpen(true)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            + Associer un capteur
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
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">Vérification professionnelle requise.</p>
      <p className="mt-1">
        Vous devez d&apos;abord faire valider vos documents avant d&apos;associer
        un capteur à une parcelle.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-600 shadow-sm">
      <p>Aucun capteur associé à cette parcelle.</p>
      <p className="mt-1 text-neutral-500">
        Associez votre ESP32 pour activer l&apos;ingestion télémétrique
        (KAT-03).
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // KAT-12 — the PENDING-only fast path: a device that has never sent
  // telemetry can still be hard-deleted via the KAT-02 unpair endpoint
  // (which 409s the moment telemetry exists). Anything past PENDING uses
  // the KAT-12 unlink flow that preserves history.
  const canHardUnpair = device.status === "PENDING";

  function handleHardUnpair() {
    if (
      !confirm(
        `Supprimer le capteur ${device.device_id} ? Cette action est définitive (aucune mesure n'a encore été envoyée).`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await unpairDevice(parcelId, device.id);
      if (!r.ok) {
        setError(unpairErrorCopy(r.error));
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
            clé : vk_…{device.api_key_last4}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            Ajouté le{" "}
            {new Date(device.created_at).toLocaleDateString("fr-FR")} ·{" "}
            {device.last_seen
              ? `dernier ping ${new Date(device.last_seen).toLocaleString("fr-FR")}`
              : "aucune télémétrie reçue"}
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
            Régénérer la clé
          </button>
          <span className="text-neutral-300">·</span>
          {canHardUnpair ? (
            <button
              type="button"
              onClick={handleHardUnpair}
              disabled={pending}
              className="text-red-700 hover:underline disabled:opacity-50"
              title="Suppression définitive — possible uniquement avant la première mesure."
            >
              {pending ? "Suppression…" : "Supprimer"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onUnlink}
              disabled={pending}
              className="text-red-700 hover:underline disabled:opacity-50"
              title="Détacher le capteur de cette parcelle. L'historique reste conservé."
            >
              Détacher
            </button>
          )}
        </div>
      )}

      {isUnlinked && (
        <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          Ce capteur a été détaché de la parcelle. L&apos;historique reste
          consultable. Associez-le à une autre parcelle depuis sa page pour le
          réactiver.
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
  const map: Record<Device["status"], { label: string; cls: string }> = {
    PENDING: {
      label: "En attente",
      cls: "bg-amber-50 text-amber-800 border-amber-200",
    },
    ACTIVE: {
      label: "En ligne",
      cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
    },
    OFFLINE: {
      label: "Hors ligne",
      cls: "bg-red-50 text-red-800 border-red-200",
    },
    UNLINKED: {
      label: "Détaché",
      cls: "bg-neutral-100 text-neutral-700 border-neutral-200",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function pairErrorCopy(detail: string): string {
  switch (detail) {
    case "device_already_paired":
      return "Un capteur est déjà associé à cette parcelle. Détachez-le avant d'en ajouter un autre.";
    case "parcel_not_found":
      return "Parcelle introuvable.";
    case "verification_required":
      return "Votre compte professionnel doit être vérifié pour associer un capteur.";
    case "role_not_allowed":
      return "Seul un agriculteur vérifié peut associer un capteur.";
    default:
      return `Erreur : ${detail}`;
  }
}

function unpairErrorCopy(detail: string): string {
  switch (detail) {
    case "device_has_telemetry_use_unlink_in_kat12":
      return "Ce capteur a déjà envoyé des mesures. La suppression de l'historique sera disponible dans une prochaine version (KAT-12).";
    case "device_not_found":
      return "Capteur introuvable (déjà détaché ?).";
    default:
      return `Erreur : ${detail}`;
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
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState<PairedDevice | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await pairDevice(parcelId, deviceId);
      if (!r.ok) {
        setError(pairErrorCopy(r.error));
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
  const valid = /^ESP-KAT-\d{3}$/.test(deviceId.trim());
  return (
    <>
      <h3 className="mb-3 text-lg font-semibold">Associer un capteur ESP32</h3>
      <label className="mb-1 block text-sm font-medium" htmlFor="device_id">
        Identifiant du capteur
      </label>
      <input
        id="device_id"
        value={deviceId}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="ESP-KAT-001"
        className="mb-2 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <p className="mb-3 text-xs text-neutral-500">
        L&apos;identifiant est imprimé sur le boîtier du capteur (format{" "}
        <code className="font-mono">ESP-KAT-NNN</code>).
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
          Annuler
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || !valid}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Association…" : "Associer"}
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
        Clé API du capteur {deviceId}
      </h3>
      <p className="mb-3 text-sm text-neutral-600">
        Copiez cette clé maintenant et flashez-la dans le firmware de votre
        ESP32.{" "}
        <strong className="text-red-700">
          Vous ne pourrez plus la consulter par la suite.
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
        {copied ? "✓ Copiée" : "Copier dans le presse-papiers"}
      </button>
      <label className="mb-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <span>
          Je confirme avoir sauvegardé la clé. Je comprends qu&apos;elle ne
          sera plus affichée.
        </span>
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={!confirmed}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          Terminer
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
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<PairedDevice | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await rotateDeviceKey(parcelId, device.id);
      if (!r.ok) {
        setError(pairErrorCopy(r.error));
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
            Régénérer la clé API
          </h3>
          <p className="mb-3 text-sm text-neutral-600">
            Une nouvelle clé sera générée pour le capteur{" "}
            <code className="font-mono">{device.device_id}</code>.{" "}
            <strong>L&apos;ancienne clé cessera immédiatement de fonctionner.</strong>{" "}
            Vous devrez reflasher le firmware avec la nouvelle valeur.
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
              Je comprends que l&apos;ancienne clé sera révoquée.
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={pending}
              className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !acknowledged}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Régénération…" : "Régénérer"}
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

function unlinkErrorCopy(detail: string): string {
  switch (detail) {
    case "device_not_found":
      return "Capteur introuvable.";
    case "device_already_unlinked":
      return "Ce capteur est déjà détaché.";
    case "role_not_allowed":
      return "Action réservée aux agriculteurs.";
    default:
      return `Erreur : ${detail}`;
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
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await unlinkDevice(parcelId, device.id);
      if (!r.ok) {
        setError(unlinkErrorCopy(r.error));
        return;
      }
      onClose(true);
    });
  }

  return (
    <ModalShell onBackdrop={() => (pending ? null : onClose(false))}>
      <h3 className="mb-2 text-lg font-semibold">
        Détacher le capteur{" "}
        <code className="font-mono">{device.device_id}</code>
      </h3>
      <p className="mb-3 text-sm text-neutral-600">
        Le capteur sera détaché de la parcelle{" "}
        <strong>{parcelName}</strong>. Concrètement :
      </p>
      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-neutral-600">
        <li>
          <strong>L&apos;ancienne clé API cesse de fonctionner</strong> dès la
          prochaine transmission de l&apos;ESP32.
        </li>
        <li>
          L&apos;historique des mesures reste conservé sous cette parcelle.
        </li>
        <li>
          Pour réutiliser ce capteur sur une autre parcelle, ouvrez sa page et
          cliquez <em>« Associer un capteur »</em> en saisissant le même
          identifiant <code className="font-mono">{device.device_id}</code> —
          une nouvelle clé sera générée.
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
          Je comprends que la clé API du capteur sera invalidée.
        </span>
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onClose(false)}
          disabled={pending}
          className="rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !acknowledged}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Détachement…" : "Détacher le capteur"}
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
