// =============================================================================
// SecondServe is a SEPARATE deployment (standalone Vite app on its own origin),
// not an internal Next route. Access from VitaChain is therefore an external
// link to a configurable base URL. Defaults to the Vite dev server so local
// dev works out of the box; set NEXT_PUBLIC_SECONDSERVE_URL in prod once the
// app is hosted.
//
// Product rule: citizen + restaurant identities are shared across both apps;
// FARMER accounts are barred from SecondServe (enforced in SecondServe itself
// via ensureSsProfile + the ss_profiles INSERT policy). So we only surface
// these links to CITIZEN / RESTAURANT.
// =============================================================================
export const SECONDSERVE_URL = (
  process.env.NEXT_PUBLIC_SECONDSERVE_URL ?? "http://localhost:5173"
).replace(/\/$/, "");
