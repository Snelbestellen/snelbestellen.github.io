// Live site-bestellingen op je telefoon. Werkt overal (4G, school) en zonder dat de pc aan staat.
// De geheime sleutel komt één keer via de QR-code van de pc-app (in het #-deel van de link, dat nooit naar een server gaat)
// en blijft daarna alleen op deze telefoon. Zonder sleutel laat deze pagina niets zien.
'use strict';
const NTFY = 'https://ntfy.sh';
const $ = id => document.getElementById(id);
const opslag = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const vanB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 1. Koppeling uit de QR-link halen en meteen uit de adresbalk wissen
(function koppel() {
  // Koppeling staat in de link (?t=..&d=..&x=..&y=..). Oude links hadden hem na een #.
  const h = new URLSearchParams(location.search.length > 1 ? location.search.slice(1) : location.hash.slice(1));
  // De koppeling blijft in het #-deel van de link staan (dat gaat nooit naar een server): een iPhone-beginschermicoon
  // heeft een eigen, leeg geheugen en krijgt alleen de link mee.
  if (h.get('t') && h.get('d') && h.get('x') && h.get('y')) {
    const nieuw = !opslag.get('koppeling', null);
    opslag.set('koppeling', { t: h.get('t'), d: h.get('d'), x: h.get('x'), y: h.get('y') });
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (nieuw && !standalone) setTimeout(() => toast('Gekoppeld! Tik nu op Deel → Zet op beginscherm.'), 400);
  }
})();
let KOP = opslag.get('koppeling', null);
if (KOP && !KOP.d) { KOP = null; opslag.set('koppeling', null); }   // oude (lange) koppeling: opnieuw scannen
// Gekoppeld maar de link mist de koppeling (bijv. na herladen)? Zet hem terug, zodat "Zet op beginscherm" hem meeneemt.
if (KOP && !location.search.includes('d=')) history.replaceState(null, '', location.pathname + '?t=' + encodeURIComponent(KOP.t) + '&d=' + KOP.d + '&x=' + KOP.x + '&y=' + KOP.y);

let bestellingen = opslag.get('bestellingen', []);   // { code, wat, naam, tijd, klaar }
let weg = opslag.get('weg', []);                     // codes die je hebt verwijderd: komen nooit terug
let filter = opslag.get('filter', 'open');
let sleutel = null;

function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000); }
function tijdTekst(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'net';
  if (m < 60) return m + ' min';
  if (m < 1440) return Math.round(m / 60) + ' uur';
  return new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function teken() {
  if (!KOP) {
    $('status').textContent = 'Niet gekoppeld'; $('status').className = 'status uit';
    $('main').innerHTML = '<div class="uitleg"><h2>Nog niet gekoppeld</h2><p>Open de Bestellingen-app op je pc, klik op <b>Telefoon koppelen</b> → <b>Laat de live-code zien</b> en scan de code met je camera.</p><p>Open de link in <b>Safari</b> en tik daar op <b>Deel → Zet op beginscherm</b>.</p><p>Staat er al een oud icoon op je beginscherm? Verwijder dat eerst.</p></div>';
    return;
  }
  const lijst = bestellingen.filter(b => filter === 'alle' || !b.klaar).sort((a, b) => b.tijd - a.tijd);
  const open = bestellingen.filter(b => !b.klaar).length;
  $('main').innerHTML = `
    <div class="filters">
      <button data-f="open" class="${filter === 'open' ? 'aan' : ''}">Open (${open})</button>
      <button data-f="alle" class="${filter === 'alle' ? 'aan' : ''}">Alle (${bestellingen.length})</button>
    </div>
    ${lijst.length ? lijst.map(b => `
      <div class="kaart ${b.nieuw ? 'nieuw' : ''} ${b.klaar ? 'klaar' : ''}">
        <div class="rij"><span class="code">#${esc(b.code)}</span><span class="tijd">${tijdTekst(b.tijd)}</span></div>
        <div class="wat">${esc(b.wat)}</div>
        <div class="wie">${esc(b.naam || 'Geen naam ingevuld')}</div>
        <div class="acties">
          <button data-kopieer="${esc(b.code)}">Code kopiëren</button>
          <button class="${b.klaar ? '' : 'klaar'}" data-klaar="${esc(b.code)}">${b.klaar ? 'Terug naar open' : '✓ Afgehandeld'}</button>
          <button class="weg" data-weg="${esc(b.code)}" aria-label="Verwijderen">🗑</button>
        </div>
      </div>`).join('') : `<div class="leeg">${filter === 'open' ? 'Geen open bestellingen.' : 'Nog geen bestellingen.'}</div>`}
    <p class="tip">Nieuwe bestellingen verschijnen vanzelf zolang deze pagina open staat. Bestellingen van de laatste 12 uur komen ook binnen als je hem later opent.</p>`;
}

document.addEventListener('click', async e => {
  const f = e.target.closest('[data-f]');
  if (f) { filter = f.dataset.f; opslag.set('filter', filter); return teken(); }
  const k = e.target.closest('[data-klaar]');
  if (k) { const b = bestellingen.find(x => x.code === k.dataset.klaar); if (b) { b.klaar = !b.klaar; b.nieuw = false; opslag.set('bestellingen', bestellingen); teken(); stuurStatus(b.code, b.klaar ? 'klaar' : 'open'); } return; }
  const w = e.target.closest('[data-weg]');
  if (w) {
    if (!confirm('Bestelling #' + w.dataset.weg + ' verwijderen? Hij gaat ook weg uit de app op je pc.')) return;
    weg.push(w.dataset.weg); weg = weg.slice(-1000); opslag.set('weg', weg);
    bestellingen = bestellingen.filter(x => x.code !== w.dataset.weg); opslag.set('bestellingen', bestellingen);
    teken(); toast('Verwijderd – ook op je pc'); stuurStatus(w.dataset.weg, 'weg'); return;
  }
  const c = e.target.closest('[data-kopieer]');
  if (c) { try { await navigator.clipboard.writeText('#' + c.dataset.kopieer); toast('#' + c.dataset.kopieer + ' gekopieerd – plak in WhatsApp-zoeken'); } catch (er) { toast('#' + c.dataset.kopieer); } }
});

// 2. Ontsleutelen: de site maakt voor de telefoon een kopie met ECDH (P-256) + AES-GCM.
async function ontsleutel(bericht) {
  if (!sleutel) sleutel = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: KOP.d, x: KOP.x, y: KOP.y, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const j = JSON.parse(bericht);
  if (!j.e || !j.d2) throw new Error('geen telefoonkopie');
  const eph = await crypto.subtle.importKey('raw', vanB64(j.e), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: eph }, sleutel, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const d = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vanB64(j.iv2) }, aes, vanB64(j.d2));
  return new TextDecoder().decode(d);
}
function lees(tekst) {
  const t = tekst.replace(/[*_]/g, '');
  const code = (t.match(/BESTELLING\s*#\s*([A-Z0-9]{4})/i) || [])[1];
  if (!code) return null;
  const regels = t.split('\n').map(s => s.trim()).filter(Boolean);
  const i = regels.findIndex(r => /BESTELLING/i.test(r));
  const naam = ((t.match(/Naam:\s*(.+)/) || [])[1] || '').trim();
  return { code: code.toUpperCase(), wat: (regels[i + 1] || '').slice(0, 120), naam: naam === '-' ? '' : naam.slice(0, 60) };
}

let laatste = opslag.get('laatste', 0);
async function verwerk(m) {
  if (!m || m.event !== 'message' || typeof m.message !== 'string' || m.message.length > 4000) return;
  if (m.time > laatste) { laatste = m.time; opslag.set('laatste', laatste); }
  let b;
  try { b = lees(await ontsleutel(m.message)); } catch (e) { return; }   // niet van de site
  if (!b || weg.includes(b.code) || bestellingen.some(x => x.code === b.code)) return;
  const live = Date.now() / 1000 - m.time < 120;
  bestellingen.push({ ...b, tijd: m.time * 1000, klaar: false, nieuw: live });
  bestellingen = bestellingen.sort((a, c) => c.tijd - a.tijd).slice(0, 300);
  opslag.set('bestellingen', bestellingen);
  teken();
  if (live) { toast('Nieuwe bestelling #' + b.code); try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) {} piep(); }
}
function piep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

// 2b. Status-sync met de pc-app (verwijderd / afgehandeld), versleuteld met een sleutel die alleen pc en telefoon kennen
let statusKey = null;
async function statusSleutel() {
  if (!statusKey) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('status:' + KOP.d));
    statusKey = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  return statusKey;
}
async function stuurStatus(code, a) {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await statusSleutel(), new TextEncoder().encode(JSON.stringify({ c: code, a, v: 'tel' }))));
    const alles = new Uint8Array(12 + ct.length); alles.set(iv); alles.set(ct, 12);
    await fetch(`${NTFY}/${encodeURIComponent(KOP.t)}-s`, { method: 'POST', body: JSON.stringify({ s: btoa(String.fromCharCode(...alles)) }) });
  } catch (e) {}
}
let laatsteS = opslag.get('laatsteS', 0);
async function verwerkStatus(m) {
  if (!m || m.event !== 'message' || typeof m.message !== 'string' || m.message.length > 2000) return;
  if (m.time > laatsteS) { laatsteS = m.time; opslag.set('laatsteS', laatsteS); }
  let s;
  try {
    const b = vanB64(JSON.parse(m.message).s);
    s = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await statusSleutel(), b.slice(12))));
  } catch (e) { return; }
  if (!s || s.v === 'tel' || !/^[A-Z0-9]{4}$/.test(s.c)) return;
  if (s.a === 'weg') {
    if (!weg.includes(s.c)) { weg.push(s.c); weg = weg.slice(-1000); opslag.set('weg', weg); }
    bestellingen = bestellingen.filter(x => x.code !== s.c);
  } else {
    const b = bestellingen.find(x => x.code === s.c);
    if (b) { b.klaar = s.a === 'klaar'; b.nieuw = false; }
  }
  opslag.set('bestellingen', bestellingen); teken();
}

// 3. Live verbinding (opent opnieuw als de telefoon wisselt van netwerk of uit de slaap komt)
let bron = null;
function verbind() {
  if (!KOP) return;
  if (bron) bron.close();
  const since = laatste ? laatste : '12h';
  bron = new EventSource(`${NTFY}/${encodeURIComponent(KOP.t)}/sse?since=${since}`);
  bron.onopen = () => { $('status').textContent = 'Live'; $('status').className = 'status aan'; };
  bron.onmessage = e => { try { verwerk(JSON.parse(e.data)); } catch (er) {} };
  bron.onerror = () => { $('status').textContent = 'Opnieuw verbinden...'; $('status').className = 'status uit'; };
  if (statusBron) statusBron.close();
  statusBron = new EventSource(`${NTFY}/${encodeURIComponent(KOP.t)}-s/sse?since=${laatsteS || '12h'}`);
  statusBron.onmessage = e => { try { verwerkStatus(JSON.parse(e.data)); } catch (er) {} };
}
let statusBron = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    bestellingen.forEach(b => { if (b.nieuw && Date.now() - b.tijd > 600e3) b.nieuw = false; });
    teken(); verbind();
  }
});
setInterval(() => { if (document.visibilityState === 'visible') teken(); }, 60000);

teken();
verbind();
