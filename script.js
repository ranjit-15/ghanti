const bellButton = document.getElementById('bellButton');
const motionButton = document.getElementById('motionButton');
// CountAPI / visitor constants
const COUNT_API_NAMESPACE = 'ghanti';
const COUNT_API_KEY = 'visitors';
const VISITOR_FLAG = 'ghanti_visited_v1';

// Vote keys and local storage flag (local-only storage)
const VOTE_YES_KEY = 'votes_yes';
const VOTE_NO_KEY = 'votes_no';
const USER_VOTE_FLAG = 'ghanti_user_vote';

const voteYesBtn = document.getElementById('voteYes');
const voteNoBtn = document.getElementById('voteNo');
const yesCountEl = document.getElementById('yesCount');
const noCountEl = document.getElementById('noCount');
// Cloudflare Worker endpoint (replace with your deployed worker URL)
const WORKER_BASE = 'https://REPLACE_WITH_YOUR_WORKER_DOMAIN.workers.dev';
const USE_WORKER = !WORKER_BASE.includes('REPLACE_WITH_YOUR_WORKER_DOMAIN');
// Turnstile sitekey for client-side widget (replace with your site key)
const TURNSTILE_SITEKEY = 'REPLACE_WITH_TURNSTILE_SITEKEY';
let turnstileWidgetId = null;
let lastTurnstileToken = null;
const turnstileResolvers = [];

function turnstileCallback(token) {
  lastTurnstileToken = token;
  while (turnstileResolvers.length) {
    const r = turnstileResolvers.shift();
    try { r(token); } catch (e) {}
  }
}

function initTurnstile() {
  if (!USE_WORKER) return;
  if (!TURNSTILE_SITEKEY || TURNSTILE_SITEKEY.includes('REPLACE')) return;
  if (typeof turnstile === 'undefined') {
    // script may not be loaded yet; try again later
    window.addEventListener('turnstile:ready', () => initTurnstile(), { once: true });
    return;
  }
  try {
    turnstileWidgetId = turnstile.render('turnstileWidget', { sitekey: TURNSTILE_SITEKEY, size: 'invisible', callback: turnstileCallback });
  } catch (err) {
    console.warn('Turnstile init failed', err);
  }
}

function requestTurnstileToken() {
  if (!turnstileWidgetId) return Promise.resolve(null);
  return new Promise((resolve) => {
    if (lastTurnstileToken) {
      const t = lastTurnstileToken;
      lastTurnstileToken = null;
      resolve(t);
      return;
    }
    turnstileResolvers.push(resolve);
    try { turnstile.execute(turnstileWidgetId); } catch (err) { console.warn('turnstile.execute failed', err); }
  });
}
let audioCtx = null;
let bellBuffer = null;
let motionEnabled = false;
let lastShake = 0;
const SHAKE_THRESHOLD = 15; // m/s^2 (tune if needed)
const SHAKE_COOLDOWN = 900; // ms between shakes
let audioUnlocked = false;

// Visitor counter: local-only per-browser counting (no external API)
async function updateVisitorCount() {
  const el = document.getElementById('visitorCount');
  if (!el) return;
  // Prefer remote worker for global counting; fallback to local-only count
  if (USE_WORKER) {
    try {
      const resp = await fetch(`${WORKER_BASE}/visitor`, { method: 'POST', credentials: 'include' });
      if (resp.ok) {
        const json = await resp.json();
        el.textContent = String(json.visitors || 0);
        return;
      }
    } catch (err) {
      console.warn('Remote visitor increment failed, falling back to local', err);
    }
  }

  // local fallback
  try {
    const hasCounted = !!localStorage.getItem(VISITOR_FLAG);
    let count = Number(localStorage.getItem('local_visitors_v1') || 0);
    if (!hasCounted) {
      count = count + 1;
      localStorage.setItem('local_visitors_v1', String(count));
      localStorage.setItem(VISITOR_FLAG, String(Date.now()));
      console.log('Visitor count incremented (local):', count);
    }
    el.textContent = String(count);
  } catch (err) {
    console.warn('updateVisitorCount failed (localStorage):', err);
    el.textContent = '—';
  }
}

// update count on load
window.addEventListener('load', () => {
  updateVisitorCount().catch(()=>{});
  // load current votes
  updateVoteUI().catch(()=>{});
  // init Turnstile widget if available
  setTimeout(initTurnstile, 400);
});

// ----- Voting (Yes / No) using CountAPI + localStorage for per-browser uniqueness -----
function voteKey(choice) {
  return choice === 'yes' ? VOTE_YES_KEY : VOTE_NO_KEY;
}

async function fetchCount(key) {
  // local-only: read counts from localStorage.
  try {
    if (key === COUNT_API_KEY) return Number(localStorage.getItem('local_visitors_v1') || 0);
    return Number(localStorage.getItem(key) || 0);
  } catch (err) {
    console.warn('fetchCount (local) failed', err);
    return 0;
  }
}

// Remote worker helpers
async function remoteGetCounts() {
  if (!USE_WORKER) return null;
  try {
    const resp = await fetch(`${WORKER_BASE}/counts`, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (err) {
    console.warn('remoteGetCounts failed', err);
    return null;
  }
}

async function remotePostVote(choice) {
  if (!USE_WORKER) return null;
  try {
    const resp = await fetch(`${WORKER_BASE}/vote`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  } catch (err) {
    console.warn('remotePostVote failed', err);
    return null;
  }
}

async function updateCount(key, amount = 1) {
  try {
    // local-only increment in localStorage
    const cur = Number(localStorage.getItem(key) || 0);
    const next = cur + amount;
    localStorage.setItem(key, String(next));
    return next;
  } catch (err) {
    console.warn('updateCount (local) failed', err);
    return null;
  }
}

async function updateVoteUI() {
  // Prefer remote counts from worker
  if (USE_WORKER) {
    const remote = await remoteGetCounts();
    if (remote) {
      yesCountEl.textContent = String(remote.yes || 0);
      noCountEl.textContent = String(remote.no || 0);
    } else {
      const yes = await fetchCount(VOTE_YES_KEY);
      const no = await fetchCount(VOTE_NO_KEY);
      yesCountEl.textContent = String(yes);
      noCountEl.textContent = String(no);
    }
  } else {
    const yes = await fetchCount(VOTE_YES_KEY);
    const no = await fetchCount(VOTE_NO_KEY);
    yesCountEl.textContent = String(yes);
    noCountEl.textContent = String(no);
  }
  const my = localStorage.getItem(USER_VOTE_FLAG);
  voteYesBtn.classList.toggle('active', my === 'yes');
  voteNoBtn.classList.toggle('active', my === 'no');
  voteYesBtn.setAttribute('aria-pressed', my === 'yes');
  voteNoBtn.setAttribute('aria-pressed', my === 'no');
  // enforce single chance: disable buttons after vote
  if (my === 'yes' || my === 'no') {
    voteYesBtn.disabled = true;
    voteNoBtn.disabled = true;
  } else {
    voteYesBtn.disabled = false;
    voteNoBtn.disabled = false;
  }
}

async function castVote(choice) {
  const prev = localStorage.getItem(USER_VOTE_FLAG);
  // enforce single chance: if user already voted, do nothing
  if (prev) return;
  // optimistically lock user vote locally so they cannot vote again
  localStorage.setItem(USER_VOTE_FLAG, choice);
  voteYesBtn.disabled = true;
  voteNoBtn.disabled = true;
  voteYesBtn.classList.toggle('active', choice === 'yes');
  voteNoBtn.classList.toggle('active', choice === 'no');
  voteYesBtn.setAttribute('aria-pressed', choice === 'yes');
  voteNoBtn.setAttribute('aria-pressed', choice === 'no');

  // Attempt to update remote worker; fall back to local storage
  if (USE_WORKER) {
    const remote = await remotePostVote(choice);
    if (remote) {
      yesCountEl.textContent = String(remote.yes || 0);
      noCountEl.textContent = String(remote.no || 0);
      return;
    }
    // remote failed — fall through to local fallback
    console.warn('Falling back to local vote storage');
  }

  const key = voteKey(choice);
  await updateCount(key, 1);
  // refresh UI from whichever source is available
  await updateVoteUI();
}

voteYesBtn.addEventListener('click', async () => {
  await castVote('yes');
});
voteNoBtn.addEventListener('click', async () => {
  await castVote('no');
});

function ensureAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

async function loadBellBuffer() {
  if (bellBuffer) return bellBuffer;
  const ctx = ensureAudioContext();
  const candidates = [
    'temple-bell.mp3',
    'temple-bell.ogg',
    'temple-bell.wav',
    // fall back to uploaded file (detected name)
    'temple-bell-sound-effect-soundeffects_5ts0ZHY4.mp3'
  ];
  for (const name of candidates) {
    try {
      const resp = await fetch(name);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const ab = await resp.arrayBuffer();
      bellBuffer = await ctx.decodeAudioData(ab);
      console.log('Loaded bell audio:', name);
      return bellBuffer;
    } catch (err) {
      // try next candidate
    }
  }
  console.warn('Could not load temple bell audio — generating synthesized bell as fallback');
  // Generate a short temple-like bell using OfflineAudioContext
  bellBuffer = await generateSynthBellBuffer(3.5);
  console.log('Generated fallback bell buffer');
  return bellBuffer;
}

// Generate a bell-like sound using OfflineAudioContext (returns AudioBuffer)
async function generateSynthBellBuffer(durationSeconds = 3.0) {
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(1, Math.ceil(sampleRate * durationSeconds), sampleRate);
  const now = 0;

  const master = offline.createGain();
  master.gain.value = 0.9;
  // We'll send master both direct and through a convolver for a richer, bell-like resonance
  master.connect(offline.destination);

  // Base frequency a bit low for a temple bell
  const base = 130; // lower pitched, more temple-like
  // Inharmonic partial ratios (slightly detuned) to emulate bell metal
  const partials = [1, 2.01, 2.99, 3.98, 5.02, 5.85, 6.8, 8.05];
  const decays = [4.2, 4.6, 3.6, 3.0, 2.6, 2.0, 1.6, 1.2];

  partials.forEach((r, i) => {
    const osc = offline.createOscillator();
    osc.type = 'sine';
    // small, purposeful inharmonicity
    osc.frequency.value = base * r * (1 + (Math.random() - 0.5) * 0.004);

    // subtle FM for metallic timbre
    const mod = offline.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = 0.3 + Math.random() * 2.5;
    const modGain = offline.createGain();
    modGain.gain.value = (0.5 + Math.random() * 1.2) * (i === 0 ? 8 : 4) ;
    mod.connect(modGain);
    modGain.connect(osc.frequency);

    const g = offline.createGain();
    // quick attack
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(1.0 - i * 0.07, now + 0.006 + i * 0.002);
    // exponential decay tailored per partial
    const stopTime = Math.max(0.6, decays[i]);
    g.gain.exponentialRampToValueAtTime(0.00001, now + stopTime + (i * 0.2));

    osc.connect(g);
    g.connect(master);
    mod.start(now);
    osc.start(now);
    osc.stop(now + durationSeconds);
    mod.stop(now + Math.min(durationSeconds, 1 + (i * 0.2)));
  });

  // Add subtle noise burst to simulate strike
  const noiseBuf = offline.createBuffer(1, Math.floor(sampleRate * 0.15), sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
  const nb = offline.createBufferSource();
  nb.buffer = noiseBuf;
  const nf = offline.createBiquadFilter();
  nf.type = 'highpass';
  nf.frequency.value = 800;
  const ng = offline.createGain();
  ng.gain.setValueAtTime(0.6, now);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  nb.connect(nf); nf.connect(ng); ng.connect(master);
  nb.start(now);

  // Create a short impulse response for a reverberant ring (convolution)
  const irDuration = Math.min(2.5, durationSeconds);
  const irLen = Math.floor(sampleRate * irDuration);
  const ir = offline.createBuffer(1, irLen, sampleRate);
  const irData = ir.getChannelData(0);
  for (let i = 0; i < irLen; i++) {
    // decaying noise to simulate metallic hall
    irData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.4) * 0.7;
  }
  const convolver = offline.createConvolver();
  convolver.buffer = ir;

  // mix master -> convolver -> destination and master direct for clarity
  const convGain = offline.createGain();
  convGain.gain.value = 0.86;
  master.connect(convolver);
  convolver.connect(convGain);
  convGain.connect(offline.destination);

  const rendered = await offline.startRendering();
  return rendered;
}

async function playBell() {
  const ctx = ensureAudioContext();
  const now = ctx.currentTime;

  // Ensure AudioContext is running (resume on browsers that block autoplay)
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
      console.log('AudioContext resumed');
    } catch (err) {
      console.warn('AudioContext resume failed:', err);
    }
  }

  const buffer = await loadBellBuffer();
  if (buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(1.0, buffer.duration));
    src.connect(gain);
    gain.connect(ctx.destination);
    src.onended = () => console.log('bell playback ended');
    console.log('Starting bell playback, buffer duration:', buffer.duration);
    src.start(now);
  } else {
    // fallback: simple synthetic bell (lightweight)
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.9, now);
    master.connect(ctx.destination);

    const partials = [880, 1320, 1760];
    partials.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(1, now + 0.004 + i*0.002);
      g.gain.exponentialRampToValueAtTime(0.00001, now + 1.4 + i*0.25);

      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 2.0 + i*0.25);
    });
  }

  // visual feedback — keep animation long enough for ringing
  bellButton.classList.add('ringing');
  // remove after 1.6s (matches CSS pulse)
  setTimeout(() => bellButton.classList.remove('ringing'), 1600);
}

bellButton.addEventListener('click', async () => {
  // resume context on user gesture if suspended
  if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
  playBell();
});

bellButton.addEventListener('keydown', async (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    playBell();
  }
});

// Motion handling
async function enableMotion() {
  if (motionEnabled) return;
  // iOS 13+ requires permission
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const resp = await DeviceMotionEvent.requestPermission();
      if (resp !== 'granted') {
        alert('Motion permission denied. Shake-to-ring requires permission.');
        return;
      }
    } catch (err) {
      console.warn('DeviceMotion permission request failed', err);
      alert('Could not request motion permission.');
      return;
    }
  }
  window.addEventListener('devicemotion', handleMotion);
  motionEnabled = true;
  motionButton.classList.add('on');
  motionButton.textContent = 'Motion: On';
}

function disableMotion() {
  if (!motionEnabled) return;
  window.removeEventListener('devicemotion', handleMotion);
  motionEnabled = false;
  motionButton.classList.remove('on');
  motionButton.textContent = 'Motion: Off';
}

function handleMotion(e) {
  const acc = e.acceleration || e.accelerationIncludingGravity;
  if (!acc) return;
  const x = acc.x || 0; const y = acc.y || 0; const z = acc.z || 0;
  const mag = Math.sqrt(x*x + y*y + z*z);
  const now = Date.now();
  if (mag > SHAKE_THRESHOLD && (now - lastShake) > SHAKE_COOLDOWN) {
    lastShake = now;
    // resume audio context if needed
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    playBell();
    if (navigator.vibrate) navigator.vibrate(180);
  }
}

// wire motion toggle button
motionButton.addEventListener('click', async () => {
  if (!motionEnabled) await enableMotion(); else disableMotion();
});

// if page is hidden, disable motion to save battery
document.addEventListener('visibilitychange', () => {
  if (document.hidden) disableMotion();
});

// Motion defaults to OFF to avoid permission prompts and battery use.
motionButton.classList.remove('on');
motionButton.textContent = 'Motion: Off';
