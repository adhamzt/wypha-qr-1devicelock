// Cloudflare Worker + Static Assets (WYPHA V24):
// 1. /api/device-lock  -> Klaim Kunci Maksimal 2 Perangkat
// 2. /api/cloud-upload -> Jembatan Upload Otomatis Foto/Aset ke Cloudflare R2
// 3. /cdn/<folder>/<file> -> Penayangan Gambar Cepat dari R2 Bucket
const memoryRegistry = new Map();
const memoryMediaStore = new Map();
const MAX_DEVICES = 2;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Wypha-Token',
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

function sanitizeSegment(str, fallback = 'umum') {
  const clean = String(str || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || fallback;
}

function decodeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!m) return null;
  const mimeType = (m[1] || 'image/webp').toLowerCase();
  const b64 = m[2];
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return { mimeType, bytes };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn/'))) {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Rute 1: Penayangan file gambar dari Cloudflare R2 (/cdn/<folder>/<filename>)
    if (url.pathname.startsWith('/cdn/') && request.method === 'GET') {
      const key = decodeURIComponent(url.pathname.slice(5)).replace(/^\/+/, '');
      if (!key) return new Response('Not Found', { status: 404 });
      const bucket = env?.WYPHA_MEDIA_BUCKET || env?.WYPHA_R2 || env?.BUCKET;
      if (bucket) {
        const obj = await bucket.get(key);
        if (obj) {
          const headers = new Headers();
          obj.writeHttpMetadata(headers);
          headers.set('etag', obj.httpEtag);
          headers.set('Access-Control-Allow-Origin', '*');
          if (!headers.has('Cache-Control')) {
            headers.set('Cache-Control', 'public, max-age=31536000, immutable');
          }
          return new Response(obj.body, { headers });
        }
      }
      if (memoryMediaStore.has(key)) {
        const item = memoryMediaStore.get(key);
        return new Response(item.bytes, {
          headers: {
            'Content-Type': item.mimeType || 'image/webp',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600'
          }
        });
      }
      return new Response('Media Not Found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Rute 2: Jembatan Upload Otomatis ke Cloudflare R2 (/api/cloud-upload)
    if (url.pathname === '/api/cloud-upload') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ ok: false, reason: 'METHOD_NOT_ALLOWED' }), { status: 405, headers: CORS_HEADERS });
      }
      try {
        const body = await request.json();
        const action = String(body.action || 'upload_photo').trim();
        const requiredToken = String(env?.WYPHA_UPLOAD_TOKEN || '').trim();
        const clientToken = String(body.token || request.headers.get('X-Wypha-Token') || '').trim();

        if (requiredToken && clientToken !== requiredToken) {
          return new Response(JSON.stringify({ ok: false, error: 'INVALID_UPLOAD_TOKEN', message: 'Token keamanan upload tidak sesuai.' }), { status: 403, headers: CORS_HEADERS });
        }

        const bucket = env?.WYPHA_MEDIA_BUCKET || env?.WYPHA_R2 || env?.BUCKET;

        if (action === 'ping_cloud') {
          return new Response(
            JSON.stringify({
              ok: true,
              provider: 'cloudflare',
              hasR2Binding: Boolean(bucket),
              mode: bucket ? 'R2_BUCKET_ACTIVE' : 'WORKER_MEMORY_FALLBACK',
              origin: url.origin,
              message: bucket
                ? 'Koneksi Cloudflare Worker + R2 Bucket aktif dan siap menerima unggahan foto!'
                : 'Worker aktif! (Catatan: Binding R2 WYPHA_MEDIA_BUCKET belum dipasang di Cloudflare, saat ini memakai memori sementara Worker).'
            }),
            { headers: CORS_HEADERS }
          );
        }

        const folder = sanitizeSegment(body.folder || body.projectId || 'proyek-wypha', 'proyek-wypha');
        const rawName = sanitizeSegment(body.fileName || ('foto-' + Date.now() + '.webp'), 'foto.webp');
        const parsed = decodeDataUrl(body.dataUrl || '');
        if (!parsed || !parsed.bytes.length) {
          return new Response(JSON.stringify({ ok: false, error: 'INVALID_IMAGE_DATA', message: 'Data gambar Base64 tidak valid atau kosong.' }), { status: 400, headers: CORS_HEADERS });
        }

        const extMap = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/svg+xml': '.svg' };
        const ext = extMap[parsed.mimeType] || '.webp';
        const baseNameNoExt = rawName.replace(/\.[a-zA-Z0-9]+$/, '');
        const finalFileName = `${baseNameNoExt}-${Date.now().toString(36).slice(-4)}${ext}`;
        const objectKey = `${folder}/${finalFileName}`;

        if (bucket) {
          await bucket.put(objectKey, parsed.bytes, {
            httpMetadata: {
              contentType: parsed.mimeType,
              cacheControl: 'public, max-age=31536000, immutable'
            }
          });
        } else {
          if (memoryMediaStore.size > 120) {
            const oldestKey = memoryMediaStore.keys().next().value;
            memoryMediaStore.delete(oldestKey);
          }
          memoryMediaStore.set(objectKey, { bytes: parsed.bytes, mimeType: parsed.mimeType });
        }

        const customPublicBase = String(body.publicBaseUrl || env?.WYPHA_PUBLIC_CDN_URL || '').trim().replace(/\/+$/, '');
        const fileUrl = customPublicBase
          ? `${customPublicBase}/${objectKey}`
          : `${url.origin}/cdn/${objectKey}`;

        return new Response(
          JSON.stringify({
            ok: true,
            provider: 'cloudflare',
            storage: bucket ? 'r2' : 'memory',
            key: objectKey,
            fileName: finalFileName,
            size: parsed.bytes.length,
            url: fileUrl,
            thumbnailUrl: fileUrl
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

    // Rute 3: Klaim Kunci Maksimal 2 Perangkat (/api/device-lock)
    if (url.pathname === '/api/device-lock') {
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
