import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {supabase, ensureSsProfile, SsFarmerBlockedError} from './lib/supabase';

// =============================================================================
// Cross-origin session handoff from VitaChain.
//
// VitaChain and SecondServe share one Supabase auth pool but live on different
// origins, so the VitaChain session (cookies) is NOT visible here. When a user
// clicks "Accéder à SecondServe" in VitaChain, that app's backend mints a
// single-use magic-link token and passes it in the URL hash
// (#ss_handoff=1&token_hash=…). We exchange it for an INDEPENDENT session via
// verifyOtp BEFORE React renders, so the user lands already authenticated with
// its own refresh-token chain (no sharing/rotation conflict with VitaChain),
// then strip the hash immediately so the token never lingers in the URL.
// =============================================================================
async function consumeHandoff(): Promise<void> {
  const hash = window.location.hash;
  if (!hash.includes('ss_handoff=1')) return;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token_hash = params.get('token_hash');

  // Strip the hash right away (keep the path + query → the target page).
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  if (!token_hash) return;

  try {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
    if (error || !data.session) {
      console.error('SecondServe handoff verifyOtp failed:', error);
      return;
    }

    // Resolve/provision the SecondServe profile and pre-seed localStorage so the
    // first render is already authenticated (AppContext reads `ss_user` lazily,
    // and the dashboards redirect to /auth when user is null).
    const profile = await ensureSsProfile(data.session.user.id, data.session.user.email ?? '');
    localStorage.setItem('ss_user', JSON.stringify(profile));
    if (profile.city) localStorage.setItem('ss_selected_city', profile.city);
  } catch (err) {
    if (err instanceof SsFarmerBlockedError) {
      // VitaChain farmer — not allowed here. Drop the session cleanly.
      await supabase.auth.signOut();
      localStorage.removeItem('ss_user');
    } else {
      console.error('SecondServe handoff failed:', err);
    }
  }
}

async function boot(): Promise<void> {
  await consumeHandoff();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
