// Cloudflare Pages Function: /api/device-lock
// Otomatis mengunci 1 Kode + 1 PIN hanya pada Perangkat Pertama (Slot 1/1) yang mengklaimnya!
const memoryRegistry = new Map();

export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  try {
    const body = await context.request.json();
    const projectId = String(body.projectId || 'wypha').trim();
    const deviceId = String(body.deviceId || '').trim().toUpperCase();
    if (!deviceId) {
      return new Response(JSON.stringify({ ok: false, reason: 'MISSING_DEVICE_ID' }), { headers: corsHeaders });
    }
    const key = `wypha_1dev_lock:${projectId}`;
    const kv = context.env?.WYPHA_DEVICE_LOCKS;
    let existingOwner = kv ? await kv.get(key) : memoryRegistry.get(key);

    if (!existingOwner) {
      if (kv) await kv.put(key, deviceId);
      else memoryRegistry.set(key, deviceId);
      return new Response(JSON.stringify({ ok: true, status: 'CLAIMED_SLOT_1_OF_1', ownerDeviceId: deviceId }), { headers: corsHeaders });
    }
    if (existingOwner === deviceId) {
      return new Response(JSON.stringify({ ok: true, status: 'VERIFIED_OWNER_DEVICE', ownerDeviceId: existingOwner }), { headers: corsHeaders });
    }
    return new Response(
      JSON.stringify({
        ok: false,
        status: 'REJECTED_SECOND_DEVICE',
        reason: 'ALREADY_CLAIMED_BY_OTHER_DEVICE',
        ownerDeviceId: existingOwner
      }),
      { headers: corsHeaders }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err.message || err) }), { status: 400, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
