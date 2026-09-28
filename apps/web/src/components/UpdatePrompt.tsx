import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { checkForUpdate, setSwRegistration } from '../lib/app-update';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      setSwRegistration(reg);
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  // An open/installed PWA otherwise only notices a new bundle on a full load.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
    const timer = window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-toast" role="status" aria-live="polite">
      <span className="pwa-update-toast__message">New version available</span>
      <div className="pwa-update-toast__actions">
        <button
          type="button"
          className="btn btn-primary pwa-update-toast__btn"
          onClick={() => updateServiceWorker(true)}
        >
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-accent pwa-update-toast__btn"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
      </div>
    </div>
  );
}
