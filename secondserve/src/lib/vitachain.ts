// VitaChain is the main platform; SecondServe lives on a separate origin.
// Set VITE_VITACHAIN_URL in production to the VitaChain deployment URL.
// Defaults to the Next.js dev server so local development works out of the box.
export const VITACHAIN_URL = (
  (import.meta.env.VITE_VITACHAIN_URL as string | undefined) ?? 'http://localhost:3000'
).replace(/\/$/, '');
