import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (opts: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            opts: Record<string, string | number | boolean>
          ) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function ensureGsiScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('GSI script failed to load')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('GSI script failed to load'));
    document.head.appendChild(script);
  });
}

export function SignIn() {
  const { config, signInWithGoogle } = useAuth();
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add('signin-page');
    return () => document.body.classList.remove('signin-page');
  }, []);

  useEffect(() => {
    if (!config?.googleClientId) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureGsiScript();
        if (cancelled) return;
        window.google!.accounts.id.initialize({
          client_id: config.googleClientId!,
          callback: async (response) => {
            try {
              await signInWithGoogle(response.credential);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Sign-in failed');
            }
          },
          auto_select: false,
          cancel_on_tap_outside: false,
        });
        if (buttonRef.current) {
          buttonRef.current.innerHTML = '';
          window.google!.accounts.id.renderButton(buttonRef.current, {
            type: 'standard',
            theme: 'filled_black',
            size: 'large',
            text: 'signin_with',
            shape: 'pill',
            logo_alignment: 'left',
          });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Google Sign-In');
      }
    })();
    return () => { cancelled = true; };
  }, [config, signInWithGoogle]);

  return (
    <main className="signin-main">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="signin-brand-icon">◎</span>
          <h1 className="signin-title">DARTS</h1>
        </div>
        <p className="signin-tagline">Sign in to track your stats across devices.</p>

        {config && !config.googleClientId ? (
          <div className="signin-error">
            <strong>Google Sign-In not configured.</strong>
            <p>Set <code>GOOGLE_CLIENT_ID</code> on the server and reload.</p>
          </div>
        ) : (
          <div ref={buttonRef} className="signin-button-slot" aria-label="Sign in with Google" />
        )}

        {error && <div className="signin-error">{error}</div>}
      </div>
    </main>
  );
}
