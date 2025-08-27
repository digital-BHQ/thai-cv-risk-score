// Thai CV risk score — no jQuery + DaisyUI
// Consent → (prompt once per session) geolocate → compute immediately → log to Google Sheet

// === Google Sheets Web App endpoint ===
const SHEETS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbx0StIXi6HxZdU83f2dxrvDld5oVO3fyLctrE0uheIZFEyMe5drEuu84KBqLLsphoJs/exec';
const SHEETS_API_KEY = ''; // optional

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);

function showSection(id) {
  ['#formSection', '#resultSection', '#about'].forEach((s) => $(s)?.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// range value badge on the right of the label row
function inlineBadgeForRange(inputId, unitText) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const field = input.closest('label.form-control');
  const labelRow = field?.querySelector('.label');
  if (!labelRow) return;

  // ensure the label row spreads content
  labelRow.classList.add('justify-between', 'items-center', 'gap-2');

  // create / append the value badge (right side)
  const badge = document.createElement('span');
  badge.id = `${inputId}_badge`;
  badge.className = 'badge badge-primary ml-auto';
  labelRow.appendChild(badge);

  const set = () => { badge.textContent = unitText ? `${input.value} ${unitText}` : `${input.value}`; };
  input.addEventListener('input', set);
  input.addEventListener('change', set);
  set();
}


// smooth show/hide for the blood mode UI
function prepTransition(block) {
  if (!block) return;
  block.style.overflow = 'hidden';
  block.style.transition = 'max-height 300ms ease, opacity 200ms ease';
}
function reveal(block) {
  if (!block) return;
  prepTransition(block);
  block.classList.remove('hidden');
  block.style.opacity = '0';
  block.style.maxHeight = '0px';
  void block.offsetHeight;
  block.style.opacity = '1';
  block.style.maxHeight = block.scrollHeight + 'px';
  setTimeout(() => {
    block.style.maxHeight = '';
    block.style.overflow = '';
    block.style.opacity = '';
    block.style.transition = '';
  }, 350);
}
function conceal(block) {
  if (!block) return;
  prepTransition(block);
  block.style.maxHeight = block.scrollHeight + 'px';
  block.style.opacity = '1';
  void block.offsetHeight;
  block.style.maxHeight = '0px';
  block.style.opacity = '0';
  setTimeout(() => {
    block.classList.add('hidden');
    block.style.maxHeight = '';
    block.style.overflow = '';
    block.style.opacity = '';
    block.style.transition = '';
  }, 350);
}

// ---------- network ----------
async function logSubmission(payload) {
  if (!SHEETS_WEBAPP_URL) return;
  try {
    await fetch(SHEETS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'no-cors'
    });
  } catch (e) {
    console.warn('logSubmission failed', e);
  }
}

// ---------- geolocation (prompt at most once per session) ----------
// Ask once per session. Cache ONLY real coords or a hard "denied" from Permissions API.
const GEO_KEY = 'user_latlon_v4';

async function getLatLonOnce({ prompt = false } = {}) {
  // 1) cache?
  try {
    const cached = JSON.parse(sessionStorage.getItem(GEO_KEY) || 'null');
    if (cached && typeof cached === 'object') {
      if (cached.denied === true) {
        console.log('[geo] cached: denied');
        return { lat: '', lon: '' };
      }
      if (typeof cached.lat === 'number' && typeof cached.lon === 'number') {
        console.log('[geo] cached coords:', cached);
        return { lat: cached.lat, lon: cached.lon };
      }
    }
  } catch {}

  // 2) permission state
  let state = 'unknown';
  try {
    if (navigator.permissions?.query) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      state = p.state; // 'granted' | 'denied' | 'prompt'
      console.log('[geo] permission:', state);
      if (state === 'denied') {
        sessionStorage.setItem(GEO_KEY, JSON.stringify({ denied: true }));
        return { lat: '', lon: '' };
      }
    }
  } catch (err) {
    console.warn('[geo] permissions.query error:', err);
  }

  // 3) only ask if allowed by state+prompt
  const shouldAsk =
    state === 'granted' || (state === 'prompt' && prompt === true) || state === 'unknown';

  if (!shouldAsk || !navigator.geolocation) {
    console.log('[geo] not asking; returning blank');
    return { lat: '', lon: '' };
  }

  // helper to wrap getCurrentPosition as a promise
  const getPos = (opts) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(err),
        opts
      );
    });

  // 4) try high-accuracy briefly, then fall back to low-accuracy longer
  try {
    const coords = await getPos({ enableHighAccuracy: true, timeout: 6000, maximumAge: 600000 });
    sessionStorage.setItem(GEO_KEY, JSON.stringify(coords));
    console.log('[geo] acquired coords (HA):', coords);
    return coords;
  } catch (e1) {
    console.warn('[geo] HA attempt failed:', e1);
    try {
      const coords = await getPos({ enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
      sessionStorage.setItem(GEO_KEY, JSON.stringify(coords));
      console.log('[geo] acquired coords (fallback):', coords);
      return coords;
    } catch (e2) {
      console.warn('[geo] fallback failed:', e2);
      // do NOT cache blanks; user may try again later this session
      return { lat: '', lon: '' };
    }
  }
}



// ---------- risk formula (ported) ----------
function TASCVDformular(age, smoke, dm, sbp, sex, tc, ldl, hdl, whr, wc) {
  let full_score = 0;
  let compare_score = 0;
  let predicted_risk = 0;
  let compare_risk = 0;
  let compare_whr = 0.52667;
  let compare_wc = 79;
  let compare_sbp = 120;
  let compare_hdl = 44;
  const sur_root = 0.964588;
  if (sex === 0) { compare_hdl = 49; }
  if (sex === 1 && age > 60) { compare_sbp = 132; }
  if (sex === 0 && age <= 60) { compare_sbp = 115; }
  if (sex === 0 && age > 60) { compare_sbp = 130; }
  if (sex === 1) { compare_whr = 0.58125; compare_wc = 93; }

  if (age > 1 && sbp >= 70) {
    if (tc > 0) {
      full_score = (0.08183 * age) + (0.39499 * sex) + (0.02084 * sbp) + (0.69974 * dm) + (0.00212 * tc) + (0.41916 * smoke);
      predicted_risk = 1 - (Math.pow(sur_root, Math.exp(full_score - 7.04423)));
      compare_score = (0.08183 * age) + (0.39499 * sex) + (0.02084 * compare_sbp) + (0.00212 * 200);
      compare_risk = 1 - (Math.pow(sur_root, Math.exp(compare_score - 7.04423)));
    } else if (whr > 0) {
      full_score = (0.079 * age) + (0.128 * sex) + (0.019350987 * sbp) + (0.58454 * dm) + (3.512566 * whr) + (0.459 * smoke);
      predicted_risk = 1 - (Math.pow(sur_root, Math.exp(full_score - 7.712325)));
      compare_score = (0.079 * age) + (0.128 * sex) + (0.019350987 * compare_sbp) + (3.512566 * compare_whr);
      compare_risk = 1 - (Math.pow(sur_root, Math.exp(compare_score - 7.712325)));
    } else if (wc > 0) {
      full_score = (0.08372 * age) + (0.05988 * sex) + (0.02034 * sbp) + (0.59953 * dm) + (0.01283 * wc) + (0.459 * smoke);
      predicted_risk = 1 - (Math.pow(sur_root, Math.exp(full_score - 7.31047)));
      compare_score = (0.08372 * age) + (0.05988 * sex) + (0.02034 * compare_sbp) + (0.01283 * compare_wc);
      compare_risk = 1 - (Math.pow(sur_root, Math.exp(compare_score - 7.31047)));
    }
  }
  return [full_score, predicted_risk, compare_score, compare_risk];
}

// ---------- compute + render; returns payload base (without lat/lon) ----------
function computeAndRender(lang = 'th') {
  const bloodOff = document.getElementById('blood_off');
  const bloodOn  = document.getElementById('blood_on');

  const tc = Array(11).fill(0); // age, smoke, dm, sbp, sex, tc, ldl, hdl, whr, wc, height
  tc[0] = parseInt(document.getElementById('age').value || '0', 10);
  tc[1] = document.getElementById('smoke').checked ? 1 : 0;
  tc[2] = document.getElementById('dm').checked ? 1 : 0;
  tc[3] = parseInt(document.getElementById('sbp').value || '0', 10);
  tc[4] = document.getElementById('sex_m').checked ? 1 : 0; // male=1, female=0
  tc[5] = parseInt(document.getElementById('tc').value || '0', 10);
  tc[9] = Math.trunc(parseFloat(document.getElementById('wc').value || '0') * 2.5); // inch → cm
  tc[10]= parseInt(document.getElementById('bdh').value || '0', 10);
  if (tc[9] > 0 && tc[10] > 0) { tc[8] = tc[9] / tc[10]; }

  // protocol
  if (bloodOff.checked) { tc[5] = 0; tc[6] = 0; tc[7] = 0; }
  else if (bloodOn.checked) { tc[9] = 0; tc[8] = 0; }

  const sum_risk = TASCVDformular(tc[0], tc[1], tc[2], tc[3], tc[4], tc[5], tc[6], tc[7], tc[8], tc[9]);
  if (!(sum_risk[1] > 0) || lang !== 'th') return null;

  showSection('#resultSection');
  const tt_risk = (sum_risk[1] / sum_risk[3]).toFixed(1);

  // % cap > 30%
  document.getElementById('sc2').textContent =
    (sum_risk[1] <= 0.3) ? (sum_risk[1] * 100).toFixed(2) : 'มากกว่า 30';

  if (tt_risk > 1.1) {
    document.getElementById('sc1').textContent = 'ซึ่งระดับความเสี่ยงของท่านสูงเป็น ' + String(tt_risk) + ' เท่า ';
  } else if (tt_risk < 0.9) {
    document.getElementById('sc1').textContent = 'ซึ่งระดับความเสี่ยงของท่านต่ำเป็น ' + String(tt_risk) + ' เท่า ';
  } else {
    document.getElementById('sc1').textContent = 'ซึ่งใกล้เคียงกับระดับความเสี่ยง ';
  }

  let sug = '';
  if (tc[1] === 1) { sug += ' เลิกสูบบุหรี่'; }
  if (tc[2] === 1) { sug += ' รักษาระดับน้ำตาลในเลือดให้อยู่ในเกณฑ์ปกติ'; }
  if (tc[3] >= 140) { sug += ' ควบคุมระดับความดันโลหิตให้ดี'; }
  if (tc[5] >= 220 || tc[6] >= 190) { sug += ' เข้ารับการรักษาเพื่อลดโคเรสเตอรอลในเลือด'; }
  if ((tc[9] >= 38 && tc[4] === 1) || (tc[9] > 32 && tc[4] === 0)) { sug += ' ลดน้ำหนักให้อยู่ในเกณฑ์ปกติ'; }

  if (sum_risk[1] < 0.1) {
    document.getElementById('sc5').textContent = 'จัดอยู่ในกลุ่มเสี่ยงน้อย';
    document.getElementById('sc4').textContent = 'เพื่อป้องกันการเกิดโรคหลอดเลือดในอนาคต ควรออกกำลังกายอย่างสม่ำเสมอ รับประทานผักผลไม้เป็นประจำ' + sug + ' และตรวจสุขภาพประจำปี';
  } else if (sum_risk[1] >= 0.1 && sum_risk[1] < 0.2) {
    document.getElementById('sc5').textContent = 'จัดอยู่ในกลุ่มเสี่ยงปานกลาง';
    document.getElementById('sc4').textContent = 'ควรออกกำลังกายอย่างสม่ำเสมอ รับประทานผักผลไม้เป็นประจำ' + sug + ' และควรได้รับการตรวจร่างกายประจำปีอย่างสม่ำเสมอ';
  } else if (sum_risk[1] >= 0.2 && sum_risk[1] <= 0.3) {
    document.getElementById('sc5').textContent = 'จัดอยู่ในกลุ่มเสี่ยงสูง';
    document.getElementById('sc4').textContent = 'ควรเข้ารับคำปรึกษาจากแพทย์ ในเบื้องต้นควรออกกำลังกายอย่างสม่ำเสมอ รับประทานผักผลไม้เป็นประจำ' + sug + ' และเข้ารับการตรวจสุขภาพประจำปีอย่างสม่ำเสมอ';
  } else if (sum_risk[1] > 0.3) {
    document.getElementById('sc5').textContent = 'จัดอยู่ในกลุ่มเสี่ยงสูงมาก';
    document.getElementById('sc4').textContent = 'ควรเข้ารับคำปรึกษาจากแพทย์ ในเบื้องต้นควรออกกำลังกายอย่างสม่ำเสมอ รับประทานผักผลไม้เป็นประจำ' + sug + ' และเข้ารับการตรวจสุขภาพประจำปีอย่างสม่ำเสมอ';
  } else {
    document.getElementById('sc5').textContent = 'ไม่พบความเสี่ยง';
    document.getElementById('sc4').textContent = 'สามารถป้องกันการเกิดโรคหลอดเลือดหัวใจในอนาคตได้ด้วยการออกกำลังกายอย่างสม่ำเสมอ';
  }

  // build payload base (no lat/lon yet)
  const now = new Date();
  const isBloodOn  = document.getElementById('blood_on').checked;
  const blood_mode = isBloodOn ? 'blood_on' : 'blood_off';
  const risk_fraction = Number(sum_risk[1]);

  let risk_band = 'low';
  if (risk_fraction >= 0.1 && risk_fraction < 0.2) risk_band = 'medium';
  else if (risk_fraction >= 0.2 && risk_fraction <= 0.3) risk_band = 'high';
  else if (risk_fraction > 0.3) risk_band = 'very_high';

  const date_bangkok_en = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit', timeZone: 'Asia/Bangkok'
  }).format(now);
  const time_bangkok_en = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Bangkok'
  }).format(now);

  return {
    api_key: SHEETS_API_KEY || undefined,
    date_bangkok_en,
    time_bangkok_en,
    app_url: window.location.href,
    // inputs
    age: tc[0],
    sex: tc[4],
    smoke: tc[1],
    dm: tc[2],
    sbp: tc[3],
    blood_mode,
    // conditional inputs
    tc_mgdl:  isBloodOn ? parseInt(document.getElementById('tc').value || '0', 10) : '',
    wc_inch: !isBloodOn ? parseFloat(document.getElementById('wc').value || '0') : '',
    wc_cm:   !isBloodOn ? Math.trunc((parseFloat(document.getElementById('wc').value || '0') * 2.5) || 0) : '',
    bdh_cm:  !isBloodOn ? parseInt(document.getElementById('bdh').value || '0', 10) : '',
    // results
    risk_percent: risk_fraction,
    risk_band
  };
}

// ---------- submit flow (non-blocking UI) ----------
async function onSubmit(e) {
  e?.preventDefault?.();

  const consent = document.getElementById('consent_ack');
  if (!consent || !consent.checked) {
    alert("โปรดยอมรับข้อตกลงก่อนส่งข้อมูล (Please check consent).");
    return;
  }

  // reuse if present; will NOT prompt again
  const { lat, lon } = await getLatLonOnce({ prompt: false });

  const payloadBase = computeAndRender('th');
  if (!payloadBase) return;

  const payload = { ...payloadBase, lat, lon };
  console.log('[sheet] payload:', payload);
  logSubmission(payload);
}


// ---------- init ----------
document.addEventListener('DOMContentLoaded', () => {
  // buttons
  $('#calcBtn')?.addEventListener('click', onSubmit);
  $('#backBtn')?.addEventListener('click', (e) => { e.preventDefault(); showSection('#formSection'); });

  // badges
  inlineBadgeForRange('age', 'ปี');
  inlineBadgeForRange('sbp', 'mmHg');
  inlineBadgeForRange('tc',  'mg/dL');
  inlineBadgeForRange('wc',  'นิ้ว');
  inlineBadgeForRange('bdh', 'ซม');

  // blood UI toggle
  const tcEl  = document.getElementById('tc');
  const wcEl  = document.getElementById('wc');
  const bdhEl = document.getElementById('bdh');
  const tcBlock  = document.getElementById('tc_wrap');
  const wcBlock  = document.getElementById('wc_wrap');
  const bdhBlock = document.getElementById('bdh_wrap');
  [tcBlock, wcBlock, bdhBlock].forEach(prepTransition);

  function applyBloodUI() {
    const usingBlood = document.getElementById('blood_on')?.checked === true;
    if (tcEl)  tcEl.disabled  = !usingBlood;
    if (wcEl)  wcEl.disabled  = usingBlood;
    if (bdhEl) bdhEl.disabled = usingBlood;

    if (usingBlood) { reveal(tcBlock); conceal(wcBlock); conceal(bdhBlock); }
    else { conceal(tcBlock); reveal(wcBlock); reveal(bdhBlock); }
  }
  $('#blood_off')?.addEventListener('change', applyBloodUI);
  $('#blood_on')?.addEventListener('change', applyBloodUI);
  applyBloodUI();

  // When consent is checked, ask for geolocation immediately and cache it (only first time)
  const consent = document.getElementById('consent_ack');
  if (consent) {
    consent.addEventListener('change', () => {
      if (consent.checked) {
        // This is the ONLY place we allow the browser prompt
        getLatLonOnce({ prompt: true });
      }
    });
  }

});
