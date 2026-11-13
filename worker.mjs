// Cloudflare Worker + Static Assets: /api/device-lock (Max 2 Devices) + ./public
// Kompatibel langsung dengan perintah deploy GitHub: npx wrangler deploy
const memoryRegistry = new Map();
const MAX_DEVICES = 2;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function parseDeviceList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(x => String(x || '').trim().toUpperCase()).filter(Boolean).slice(0, MAX_DEVICES);
  return String(raw)
    .split(/[,|;\n]+/)
    .map(x => x.trim().toUpperCase())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, MAX_DEVICES);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/device-lock') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
      }
      if (request.method === 'POST' || request.method === 'GET') {
        try {
          const body = request.method === 'POST'
            ? await request.json()
            : Object.fromEntries(url.searchParams.entries());
          const action = String(body.action || 'claim_or_verify').trim();
          const projectId = String(body.projectId || 'wypha').trim();
          const deviceId = String(body.deviceId || '').trim().toUpperCase();
          const key = `wypha_2dev_lock:${projectId}`;
          const kv = env?.WYPHA_DEVICE_LOCK || env?.WYPHA_DEVICE_LOCKS;
          const rawExisting = kv ? await kv.get(key) : memoryRegistry.get(key);
          const existingOwners = parseDeviceList(rawExisting);

          if (action === 'reset') {
            if (kv) await kv.delete(key);
            else memoryRegistry.delete(key);
            return new Response(
              JSON.stringify({ ok: true, status: 'RESET_SUCCESS', projectId, maxDevices: MAX_DEVICES, usedSlots: 0, ownerDeviceIds: [] }),
              { headers: CORS_HEADERS }
            );
          }

          if (!deviceId) {
            return new Response(JSON.stringify({ ok: false, reason: 'MISSING_DEVICE_ID' }), { headers: CORS_HEADERS });
          }

          if (existingOwners.includes(deviceId)) {
            return new Response(
              JSON.stringify({
                ok: true,
                status: 'VERIFIED_OWNER_DEVICE',
                slot: existingOwners.indexOf(deviceId) + 1,
                maxDevices: MAX_DEVICES,
                usedSlots: existingOwners.length,
                ownerDeviceIds: existingOwners,
                ownerDeviceId: existingOwners.join(' | ')
              }),
              { headers: CORS_HEADERS }
            );
          }

          if (existingOwners.length < MAX_DEVICES) {
            existingOwners.push(deviceId);
            const joined = existingOwners.join(' | ');
            if (kv) await kv.put(key, joined);
            else memoryRegistry.set(key, joined);
            return new Response(
              JSON.stringify({
                ok: true,
                status: existingOwners.length === 1 ? 'CLAIMED_SLOT_1_OF_2' : 'CLAIMED_SLOT_2_OF_2',
                slot: existingOwners.length,
                maxDevices: MAX_DEVICES,
                usedSlots: existingOwners.length,
                ownerDeviceIds: existingOwners,
                ownerDeviceId: joined
              }),
              { headers: CORS_HEADERS }
            );
          }

          return new Response(
            JSON.stringify({
              ok: false,
              status: 'REJECTED_MAX_2_DEVICES',
              reason: 'MAX_2_DEVICES_ALREADY_CLAIMED',
              maxDevices: MAX_DEVICES,
              usedSlots: existingOwners.length,
              ownerDeviceIds: existingOwners,
              ownerDeviceId: existingOwners.join(' | ')
            }),
            { headers: CORS_HEADERS }
          );
        } catch (err) {
          return new Response(
            JSON.stringify({ ok: false, error: String(err.message || err) }),
            { status: 400, headers: CORS_HEADERS }
          );
        }
      }
      return new Response(JSON.stringify({ ok: false, reason: 'METHOD_NOT_ALLOWED' }), {
        status: 405,
        headers: CORS_HEADERS
      });
    }

    const res = await env.ASSETS.fetch(request);
    if (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/service-worker.js') || url.pathname.endsWith('/icon-192.png') || url.pathname.endsWith('/icon-512.png')) {
      const headers = new Headers(res.headers);
      if (url.pathname.endsWith('.webmanifest')) headers.set('Content-Type', 'application/manifest+json; charset=utf-8');
      if (url.pathname.endsWith('service-worker.js')) headers.set('Content-Type', 'application/javascript; charset=utf-8');
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  }
};
