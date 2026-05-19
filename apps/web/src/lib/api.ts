import { authHeaders, clearToken } from './auth';

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = `Request failed (${res.status})`;
    if (text) {
      try {
        const data = JSON.parse(text) as { error?: string };
        msg = data.error || text;
      } catch {
        msg = text;
      }
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

export const api = {
  get: <T>(url: string) =>
    fetch(url, { headers: authHeaders() }).then((r) => handle<T>(r)),
  post: <T>(url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  put: <T>(url: string, body: unknown) =>
    fetch(url, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  del: (url: string) =>
    fetch(url, { method: 'DELETE', headers: authHeaders() }).then((r) => handle<void>(r)),
};
