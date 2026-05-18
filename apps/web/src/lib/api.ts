async function handle<T>(res: Response): Promise<T> {
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

export const api = {
  get: <T>(url: string) => fetch(url).then((r) => handle<T>(r)),
  post: <T>(url: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  put: <T>(url: string, body: unknown) =>
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r)),
  del: (url: string) => fetch(url, { method: 'DELETE' }).then((r) => handle<void>(r)),
};
