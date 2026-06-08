"use client";

import { DownloadIcon } from "@/app/dashboard/farmer/_ui/Icon";

export function PrintControls() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="vc-btn-primary"
    >
      <DownloadIcon size={14} /> Imprimer / Enregistrer en PDF
    </button>
  );
}
