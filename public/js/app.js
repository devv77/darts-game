// Shared utilities
const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error);
    }
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
  }
};

function parseDartScore(dart) {
  if (!dart || dart === '0') return 0;
  if (dart === 'SB') return 25;
  if (dart === 'DB') return 50;
  const prefix = dart[0];
  const num = parseInt(dart.slice(1));
  if (isNaN(num)) return 0;
  if (prefix === 'S') return num;
  if (prefix === 'D') return num * 2;
  if (prefix === 'T') return num * 3;
  return 0;
}

function formatDart(dart) {
  if (!dart || dart === '0') return 'Miss';
  if (dart === 'SB') return '25';
  if (dart === 'DB') return 'Bull';
  const prefix = dart[0];
  const num = dart.slice(1);
  if (prefix === 'S') return num;
  if (prefix === 'D') return 'D' + num;
  if (prefix === 'T') return 'T' + num;
  return dart;
}

function getGameIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}
