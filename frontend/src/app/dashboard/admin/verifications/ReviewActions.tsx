"use client";

import { useActionState, useRef, useState } from "react";

import { approveSubmission, rejectSubmission } from "./actions";

const initState = { error: null };

export function ReviewActions({ submissionId }: { submissionId: string }) {
  const [approveState, approveAction, approvePending] = useActionState(
    approveSubmission,
    initState,
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectSubmission,
    initState,
  );
  const [showReject, setShowReject] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="mt-3 space-y-2">
      {(approveState.error ?? rejectState.error) ? (
        <p className="text-xs text-red-700">
          {approveState.error ?? rejectState.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <form action={approveAction}>
          <input type="hidden" name="submission_id" value={submissionId} />
          <button
            type="submit"
            disabled={approvePending || rejectPending}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {approvePending ? "En cours…" : "Approuver"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setShowReject((v) => !v)}
          disabled={approvePending || rejectPending}
          className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Rejeter
        </button>
      </div>

      {showReject ? (
        <form action={rejectAction} className="space-y-2">
          <input type="hidden" name="submission_id" value={submissionId} />
          <textarea
            ref={noteRef}
            name="reviewer_note"
            rows={2}
            placeholder="Motif du rejet (optionnel)"
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={rejectPending}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {rejectPending ? "En cours…" : "Confirmer le rejet"}
            </button>
            <button
              type="button"
              onClick={() => setShowReject(false)}
              className="text-xs text-neutral-500 hover:text-neutral-700"
            >
              Annuler
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
