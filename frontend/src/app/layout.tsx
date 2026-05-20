import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "VitaChain", template: "%s · VitaChain" },
  description: "Écosystème anti-gaspillage agro-alimentaire — MVD",
  // Block indexing until the demo; INF-06 / launch flips this off.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `lang` / `dir` are hardcoded here; I18N-03 swaps them to dynamic values
  // driven by the cookie-stored locale once the i18n provider lands.
  return (
    <html lang="fr" dir="ltr">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
