import {
  CheckCircleIcon,
  ClockIcon,
  PackageIcon,
  SatelliteIcon,
  ShoppingBagIcon,
  XIcon,
} from "@/app/dashboard/farmer/_ui/Icon";

type Status =
  | "PENDING"
  | "PARTIALLY_ACCEPTED"
  | "ACCEPTED"
  | "REJECTED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURNED";

type Step = {
  key: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const HAPPY_PATH: Step[] = [
  {
    key: "PENDING",
    label: "Commande reçue",
    hint: "VitaChain valide votre commande.",
    icon: ShoppingBagIcon,
  },
  {
    key: "ACCEPTED",
    label: "Acceptée par les producteurs",
    hint: "Préparation chez les producteurs sélectionnés.",
    icon: CheckCircleIcon,
  },
  {
    key: "IN_PROGRESS",
    label: "En cours de livraison",
    hint: "Notre logistique a récupéré la marchandise.",
    icon: SatelliteIcon,
  },
  {
    key: "DELIVERED",
    label: "Livrée",
    hint: "Commande remise à votre établissement.",
    icon: PackageIcon,
  },
];

function reachedIndex(status: Status): number {
  switch (status) {
    case "PENDING":
      return 0;
    case "PARTIALLY_ACCEPTED":
    case "ACCEPTED":
      return 1;
    case "IN_PROGRESS":
      return 2;
    case "DELIVERED":
      return 3;
    default:
      return 0;
  }
}

export function OrderTimeline({
  status,
  createdAt,
  updatedAt,
}: {
  status: Status;
  createdAt: string;
  updatedAt: string;
}) {
  if (
    status === "CANCELLED" ||
    status === "REJECTED" ||
    status === "RETURNED"
  ) {
    const terminalLabel =
      status === "CANCELLED"
        ? "Commande annulée"
        : status === "RETURNED"
          ? "Commande retournée"
          : "Commande refusée";
    return (
      <div className="vc-card flex items-start gap-3 p-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-red-50">
          <XIcon size={16} className="text-red-600" />
        </span>
        <div>
          <p className="text-sm font-semibold text-neutral-900">
            {terminalLabel}
          </p>
          <p className="text-xs text-neutral-500">
            Dernière mise à jour le {new Date(updatedAt).toLocaleString("fr-MA")}
          </p>
        </div>
      </div>
    );
  }

  const reached = reachedIndex(status);

  return (
    <div className="vc-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <ClockIcon size={16} className="text-leaf-700" />
        <h2 className="text-sm font-semibold text-neutral-900">
          Suivi de livraison
        </h2>
      </div>

      <ol className="relative space-y-5 border-l border-neutral-200 pl-6">
        {HAPPY_PATH.map((step, i) => {
          const Icon = step.icon;
          const done = i < reached;
          const active = i === reached;
          const tone = done
            ? "bg-leaf-600 text-white"
            : active
              ? "bg-leaf-100 text-leaf-700 ring-4 ring-leaf-50"
              : "bg-neutral-100 text-neutral-400";
          return (
            <li key={step.key} className="relative">
              <span
                className={`absolute -left-[34px] top-0 grid h-7 w-7 place-items-center rounded-full ${tone}`}
              >
                {done ? <CheckCircleIcon size={14} /> : <Icon size={14} />}
              </span>
              <p
                className={`text-sm font-medium ${
                  done || active ? "text-neutral-900" : "text-neutral-500"
                }`}
              >
                {step.label}
              </p>
              <p className="text-xs text-neutral-500">{step.hint}</p>
              {i === 0 && (
                <p className="mt-1 text-[11px] text-neutral-400">
                  {new Date(createdAt).toLocaleString("fr-MA")}
                </p>
              )}
              {active && i > 0 && (
                <p className="mt-1 text-[11px] text-leaf-700">
                  Mise à jour le {new Date(updatedAt).toLocaleString("fr-MA")}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {status === "PARTIALLY_ACCEPTED" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Certaines lignes n&apos;ont pas pu être honorées par les producteurs.
          Consultez le détail des articles ci-dessous.
        </p>
      )}
    </div>
  );
}
