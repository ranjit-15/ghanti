addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// NOTE: before deploying, set SITE_ORIGIN in wrangler.toml to your GitHub Pages origin
const SITE_ORIGIN = typeof SITE_ORIGIN !== 'undefined' ? SITE_ORIGIN : null;

async function handleRequest(request) {
  const url = new URL(request.url);
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request)
    });
  }

  try {
    if (url.pathname === '/counts' && request.method === 'GET') {
      const counts = await getCounts();
      return jsonResponse(counts, { headers: corsHeaders(request) });
    }

    if (url.pathname === '/visitor' && request.method === 'POST') {
      const res = await handleVisitor(request);
      return res;
    }

    if (url.pathname === '/vote' && request.method === 'POST') {
      const res = await handleVote(request);
      return res;
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(request) });
  } catch (err) {
    return new Response('Worker error: ' + err.stack || err, { status: 500, headers: corsHeaders(request) });
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || request.headers.get('origin') || SITE_ORIGIN || '*';
  const allowOrigin = (SITE_ORIGIN && origin === SITE_ORIGIN) ? origin : (SITE_ORIGIN || origin);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(obj, opts = {}) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  return new Response(body, { status: opts.status || 200, headers });
}

async function getCounts() {
  const yes = Number(await VOTES_KV.get('counts:yes') || 0);
  const no = Number(await VOTES_KV.get('counts:no') || 0);
  const visitors = Number(await VOTES_KV.get('counts:visitors') || 0);
  return { yes, no, visitors };
}

async function handleVisitor(request) {
  // ensure device id cookie
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let deviceId = cookies['ghanti_device'];
  const headers = corsHeaders(request);
  let setCookie = null;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    setCookie = makeSetCookie(deviceId);
  }

  // only count once per device
  const visitedKey = `visited:${deviceId}`;
  const already = await VOTES_KV.get(visitedKey);
  if (!already) {
    // increment visitors
    const cur = Number(await VOTES_KV.get('counts:visitors') || 0);
    await VOTES_KV.put('counts:visitors', String(cur + 1));
    await VOTES_KV.put(visitedKey, '1');
  }

  const counts = await getCounts();
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify(counts), { status: 200, headers });
}

async function handleVote(request) {
  const headers = corsHeaders(request);
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let deviceId = cookies['ghanti_device'];
  let setCookie = null;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    setCookie = makeSetCookie(deviceId);
  }

  const body = await request.json().catch(() => ({}));
  const choice = body && body.choice;
  const token = body && body.token;
  // Verify Turnstile token when provided
  if (!token) {
    return new Response('Missing Turnstile token', { status: 400, headers });
  }
  const verified = await verifyTurnstileToken(token, request);
  if (!verified) {
    return new Response('Turnstile verification failed', { status: 403, headers });
  }
  if (!choice || (choice !== 'yes' && choice !== 'no')) {
    return new Response('Invalid choice', { status: 400, headers });
  }

  const deviceKey = `device:${deviceId}`;
  const prev = await VOTES_KV.get(deviceKey);
  if (prev === choice) {
    const counts = await getCounts();
    if (setCookie) headers['Set-Cookie'] = setCookie;
    return new Response(JSON.stringify(counts), { status: 200, headers });
  }

  // decrement previous
  if (prev === 'yes' || prev === 'no') {
    const prevKey = `counts:${prev}`;
    const prevCount = Number(await VOTES_KV.get(prevKey) || 0);
    await VOTES_KV.put(prevKey, String(Math.max(0, prevCount - 1)));
  }

  // increment new
  const key = `counts:${choice}`;
  const cur = Number(await VOTES_KV.get(key) || 0);
  await VOTES_KV.put(key, String(cur + 1));
  await VOTES_KV.put(deviceKey, choice);

  const counts = await getCounts();
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return new Response(JSON.stringify(counts), { status: 200, headers });
}

// Verify Turnstile token with Cloudflare
async function verifyTurnstileToken(token, request) {
  // TURNSTILE_SECRET must be set as a Wrangler secret (wrangler secret put TURNSTILE_SECRET)
  if (typeof TURNSTILE_SECRET === 'undefined' || !TURNSTILE_SECRET) {
    // If secret not present, fail safe (don't verify)
    console.warn('TURNSTILE_SECRET is not set; rejecting vote for safety');
    return false;
  }
  const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const form = new URLSearchParams();
  form.append('secret', TURNSTILE_SECRET);
  form.append('response', token);
  // remoteip optional
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for');
  if (ip) form.append('remoteip', ip);
  try {
    const resp = await fetch(verifyUrl, { method: 'POST', body: form });
    if (!resp.ok) return false;
    const j = await resp.json();
    return !!j.success;
  } catch (err) {
    console.error('Turnstile verify error', err);
    return false;
  }
}

function parseCookies(cookieHeader) {
  const out = {};
  cookieHeader.split(';').forEach(part => {
    const p = part.trim();
    if (!p) return;
    const eq = p.indexOf('=');
    if (eq === -1) return;
    const k = p.substring(0, eq).trim();
    const v = p.substring(eq + 1).trim();
    out[k] = v;
  });
  return out;
}

function makeSetCookie(id) {
  // 10 years
  const maxAge = 10 * 365 * 24 * 60 * 60;
  return `ghanti_device=${id}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
