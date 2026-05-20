import { VitaLogoMark } from "./Icon";

/**
 * Wordmark + leaf glyph. Used in the sidebar, auth pages, and landing nav.
 * Two sizes: "sm" for in-app chrome, "md" for hero / auth.
 */

export function Logo({
  size = "sm",
  tone = "default",
}: {
  size?: "sm" | "md";
  tone?: "default" | "white";
}) {
  const titleSize = size === "md" ? "text-xl" : "text-base";
  const subSize = size === "md" ? "text-[11px]" : "text-[10px]";
  const titleColor = tone === "white" ? "text-white" : "text-leaf-800";
  const subColor = tone === "white" ? "text-white/70" : "text-leaf-600";
  const markColor = tone === "white" ? "text-white" : "text-leaf-600";

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`grid h-8 w-8 place-items-center rounded-lg ${
          tone === "white"
            ? "bg-white/10 ring-1 ring-white/20"
            : "bg-leaf-50 ring-1 ring-leaf-100"
        }`}
      >
        <VitaLogoMark size={20} className={markColor} />
      </span>
      <span className="flex flex-col leading-tight">
        <span className={`font-semibold tracking-tight ${titleSize} ${titleColor}`}>
          VitaChain
        </span>
        <span className={`uppercase tracking-[0.18em] ${subSize} ${subColor}`}>
          Katara
        </span>
      </span>
    </span>
  );
}
