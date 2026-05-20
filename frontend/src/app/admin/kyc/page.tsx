import { fetchPendingSubmissions } from "./actions";
import { ReviewActions } from "./ReviewActions";

export const dynamic = "force-dynamic";

const DOCTYPE: Record<string, string> = {
  RC: "Registre de commerce",
  CIN: "Carte d'identité nationale",
  AGRI_CARD: "Carte d'agriculteur",
  OTHER: "Autre",
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export default async function AdminKycPage() {
  let submissions: Awaited<ReturnType<typeof fetchPendingSubmissions>>;
  let fetchError: string | null = null;
  try {
    submissions = await fetchPendingSubmissions();
  } catch (e) {
    submissions = [];
    fetchError = e instanceof Error ? e.message : "Erreur inconnue";
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">File KYC</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Documents en attente de vérification
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-800">
          {submissions.length} en attente
        </span>
      </div>

      {fetchError ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Impossible de charger les soumissions : {fetchError}
        </div>
      ) : submissions.length === 0 ? (
        <div className="rounded border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          Aucun document en attente. Tout est à jour !
        </div>
      ) : (
        <ul className="space-y-4">
          {submissions.map((sub) => (
            <li
              key={sub.id}
              className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {sub.user_name ?? sub.user_email}
                  </p>
                  {sub.user_name ? (
                    <p className="text-xs text-neutral-500">{sub.user_email}</p>
                  ) : null}
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  PENDING
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-neutral-400">Type</dt>
                  <dd className="font-medium text-neutral-700">
                    {DOCTYPE[sub.document_type] ?? sub.document_type}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Format</dt>
                  <dd className="font-medium text-neutral-700">
                    {(sub.mime_type ?? "—").replace("image/", "").replace("application/", "")}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Taille</dt>
                  <dd className="font-medium text-neutral-700">
                    {sub.size_bytes != null ? formatBytes(sub.size_bytes) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-400">Soumis le</dt>
                  <dd className="font-medium text-neutral-700">
                    {formatDate(sub.submitted_at)}
                  </dd>
                </div>
              </dl>

              {sub.preview_url ? (
                <p className="mt-3 text-xs">
                  <a
                    href={sub.preview_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline hover:text-blue-800"
                  >
                    Voir le document
                  </a>
                </p>
              ) : null}

              <ReviewActions submissionId={sub.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
