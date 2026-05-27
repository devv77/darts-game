import { useAuth } from '../contexts/AuthContext';

// Fixed corner badge shown only when the server reports a test configuration
// (TEST_GOOGLE_CLIENT_ID is in use). Hidden entirely in production.
export function TestModeBadge() {
  const { config } = useAuth();
  if (!config?.testConfig) return null;
  return (
    <div className="test-mode-badge" role="status" aria-label="Test configuration active">
      Test config
    </div>
  );
}
