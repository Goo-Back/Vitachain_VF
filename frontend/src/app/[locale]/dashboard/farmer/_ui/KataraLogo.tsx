import Image from "next/image";

/**
 * Katara logo — the blue water-drop / green-leaf pinwheel mark
 * (/public/katara.png) paired with the "Katara" wordmark.
 *
 * Scoped to the farmer dashboard: the rest of the app (restaurant chrome,
 * auth, landing) still renders the shared VitaChain <Logo />. Two sizes:
 * "sm" for in-app chrome, "md" for hero surfaces.
 */

export function KataraLogo({
  size = "sm",
  tone = "default",
}: {
  size?: "sm" | "md";
  tone?: "default" | "white";
}) {
  const titleSize = size === "md" ? "text-xl" : "text-base";
  const markPx = size === "md" ? 40 : 32;
  const titleColor = tone === "white" ? "text-white" : "katara-text";

  return (
    <span className="group inline-flex items-center gap-2">
      <Image
        src="/katara.png"
        alt="Katara"
        width={markPx}
        height={markPx}
        priority
        className="object-contain transition-transform duration-300 ease-out group-hover:scale-105 group-hover:-rotate-3"
        style={{ width: markPx, height: markPx }}
      />
      <span className={`font-semibold tracking-tight ${titleSize} ${titleColor}`}>
        Katara
      </span>
    </span>
  );
}
