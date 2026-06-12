import { api } from './api';

// Baked into the bundle at build time (Vite define ← Docker GIT_SHA).
export const FRONTEND_VERSION: string = __APP_VERSION__;

export interface HealthResponse {
  status: string;
  version: string;
  backend: { status: string; version: string; uptimeSeconds: number };
  frontend: { status: string; version: string };
  startedAt: string;
  time: string;
}

export const getHealth = () => api.get<HealthResponse>('/api/health');
