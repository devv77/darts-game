import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

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
