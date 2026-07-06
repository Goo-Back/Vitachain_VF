"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

import { requestUploadUrl, submitDocument } from "./actions";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const MIME_FOR_FILE = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

type DocType = "RC" | "CIN" | "AGRI_CARD" | "OTHER";

function detectMime(file: File): keyof typeof MIME_FOR_FILE | null {
  // Browser-reported MIME first, fallback to extension. Storage policy will
  // reject anything else server-side; this is UX-only pre-flight.
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/jpeg") return "jpeg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext in MIME_FOR_FILE ? (ext as keyof typeof MIME_FOR_FILE) : null;
}

export default function UploadForm() {
  const t = useTranslations("onboarding.uploadForm");
  const router = useRouter();
  const [docType, setDocType] = useState<DocType>("CIN");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError(t("errors.fileRequired"));
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(t("errors.fileTooLarge"));
      return;
    }
    const extKey = detectMime(file);
    if (!extKey) {
      setError(t("errors.invalidFormat"));
      return;
    }
    const mime = MIME_FOR_FILE[extKey];

    setBusy(true);
    try {
      const { upload_url, storage_path } = await requestUploadUrl({
        document_type: docType,
        mime_type: mime,
        size_bytes: file.size,
      });

      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`upload_failed:${putRes.status}`);
      }

      await submitDocument({ document_type: docType, storage_path });
      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown_error";
      setError(t("errors.submitFailed", { message: msg }));
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col gap-4 rounded border border-emerald-200 bg-emerald-50 p-6">
        <div className="flex items-start gap-3">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
              clipRule="evenodd"
            />
          </svg>
          <div>
            <p className="font-semibold text-emerald-900">
              {t("success.title")}
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              {t("success.body")}
            </p>
          </div>
        </div>
        <button
          onClick={() => router.refresh()}
          className="self-start rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {t("success.viewStatus")}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded border border-neutral-200 p-4"
    >
      {error ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800"
        >
          {error}
        </div>
      ) : null}

      <label className="text-xs text-neutral-600">
        {t("docTypeLabel")}
        <select
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocType)}
          className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm"
          disabled={busy}
        >
          <option value="CIN">{t("docTypeOptions.cin")}</option>
          <option value="RC">{t("docTypeOptions.rc")}</option>
          <option value="AGRI_CARD">{t("docTypeOptions.agriCard")}</option>
          <option value="OTHER">{t("docTypeOptions.other")}</option>
        </select>
      </label>

      <label className="text-xs text-neutral-600">
        {t("fileLabel")}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm"
          disabled={busy}
          required
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="mt-2 rounded bg-emerald-600 p-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-neutral-400"
      >
        {busy ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
