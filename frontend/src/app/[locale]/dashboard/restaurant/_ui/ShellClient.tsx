"use client";

import { useEffect, useState } from "react";

import { Sidebar } from "./Sidebar";

const STORAGE_KEY = "vita_resto_sidebar_collapsed";

export function ShellClient({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "1") setCollapsed(true);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed, hydrated]);

  return (
    <>
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <div
        className={`transition-[padding] duration-300 ease-out ${
          collapsed ? "lg:ps-20" : "lg:ps-64"
        }`}
      >
        {children}
      </div>
    </>
  );
}
