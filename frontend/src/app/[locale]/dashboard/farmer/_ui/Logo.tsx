import Image from "next/image";

/**
 * VitaChain logo: the four-colour pinwheel mark (/public/vitachain_logo.png)
 * paired with the wordmark. Used in the sidebar, auth pages, and landing nav.
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
  const markPx = size === "md" ? 40 : 32;
  const titleColor = tone === "white" ? "text-white" : "text-leaf-800";

  return (
    <span className="inline-flex items-center gap-2">
      <Image
        src="/vitachain_logo.png"
        alt="VitaChain"
        width={markPx}
        height={markPx}
        priority
        className="object-contain"
        style={{ width: markPx, height: markPx }}
      />
      <span className={`font-semibold tracking-tight ${titleSize} ${titleColor}`}>
        VitaChain
      </span>
    </span>
  );
}
