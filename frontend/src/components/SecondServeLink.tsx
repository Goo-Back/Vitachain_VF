"use client";

import { createSecondserveHandoffUrl } from "@/app/_actions/secondserve-handoff";
import { SECONDSERVE_URL } from "@/lib/secondserve";

/**
 * Opens the SecondServe app (separate origin) already authenticated. On click,
 * asks the backend (via a server action) for a single-use magic-link token and
 * opens SecondServe with it in the URL hash; SecondServe exchanges it for its
 * own independent session (verifyOtp). Falls back to a plain manual-login link
 * if the handoff fails (e.g. backend unreachable). Always opens in a new tab so
 * the VitaChain session is preserved.
 */
export function SecondServeLink({
  path,
  className,
  children,
}: {
  /** Path within the SecondServe app, e.g. "/restaurant-dashboard" or "/meals". */
  path: string;
  className?: string;
  children: React.ReactNode;
}) {
  const href = `${SECONDSERVE_URL}${path}`;

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    let url = href;
    try {
      url = await createSecondserveHandoffUrl(path);
    } catch {
      // Handoff unavailable → plain link; user logs in on SecondServe directly.
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
