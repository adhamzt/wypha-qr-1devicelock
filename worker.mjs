// Cloudflare Worker + Static Assets: /api/device-lock + ./public
// Kompatibel langsung dengan perintah deploy GitHub: npx wrangler deploy
const memoryRegistry = new Map();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/device-lock') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
      }
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const projectId = String(body.projectId || 'wypha').trim();
          const deviceId = String(body.deviceId || '').trim().toUpperCase();
          if (!deviceId) {
            return new Response(JSON.stringify({ ok: false, reason: 'MISSING_DEVICE_ID' }), { headers: CORS_HEADERS });
          }
          const key = `wypha_1dev_lock:${projectId}`;
          const kv = env?.WYPHA_DEVICE_LOCK || env?.WYPHA_DEVICE_LOCKS;
          const existingOwner = kv ? await kv.get(key) : memoryRegistry.get(key);

          if (!existingOwner) {
            if (kv) await kv.put(key, deviceId);
            else memoryRegistry.set(key, deviceId);
            return new Response(
              JSON.stringify({ ok: true, status: 'CLAIMED_SLOT_1_OF_1', ownerDeviceId: deviceId }),
              { headers: CORS_HEADERS }
            );
          }
          if (existingOwner === deviceId) {
            return new Response(
              JSON.stringify({ ok: true, status: 'VERIFIED_OWNER_DEVICE', ownerDeviceId: existingOwner }),
              { headers: CORS_HEADERS }
            );
          }
          return new Response(
            JSON.stringify({
              ok: false,
              status: 'REJECTED_SECOND_DEVICE',
              reason: 'ALREADY_CLAIMED_BY_OTHER_DEVICE',
              ownerDeviceId: existingOwner
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

    return env.ASSETS.fetch(request);
  }
};
