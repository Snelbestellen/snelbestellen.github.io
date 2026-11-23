const NUMMER = '31610382016';
const WA = document.querySelector('.zweef svg').outerHTML;
const naamVeld = document.getElementById('naam');
try { naamVeld.value = localStorage.getItem('naam') || ''; } catch (e) {}

const waLink = tekst => 'https://wa.me/' + NUMMER + '?text=' + encodeURIComponent(tekst);
// Invoer opschonen: geen enters of opmaaktekens, zodat niemand de vorm van het bericht kan namaken.
const schoon = (s, max) => String(s || '').replace(/[\r\n\t*_~`#<>{}\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const naam = () => schoon(naamVeld.value, 40);
// Kort bestelnummer, zodat je in de chat makkelijk naar een bestelling verwijst.
const nieuweCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
let CODE = nieuweCode();

// Geen emoji: WhatsApp op pc maakt daar via een link vraagtekens van.
function waarden(kaart) {
  const v = {};
  kaart.querySelectorAll('[data-veld]').forEach(el => {
    v[el.dataset.veld] = schoon(el.classList.contains('opties') ? (el.querySelector('.aan') || {}).textContent : el.value, 40);
  });
  return v;
}
function samenvatting(p, v) {
  const n = Math.min(Math.max(parseInt(v.Aantal, 10) || 1, 1), 20);
  if (p === 'AirPods') return n + 'x AirPods ' + (v.Model || '');
  if (p === 'Shirt') return n + 'x ' + (v['Club/seizoen'] || 'Shirt (club nog doorgeven)') + ' ' + ({ Thuis: 'thuisshirt', Uit: 'uitshirt', Third: 'third shirt' }[v.Type] || 'shirt') + ' - maat ' + (v.Maat || '?');
  if (p === 'Spotify Premium') return 'Spotify Premium ' + (v.Soort || '') + ' - ' + (v.Duur || '');
  return p;
}
function bericht(kaart) {
  const regel = samenvatting(kaart.dataset.product, waarden(kaart)).replace(/\s+/g, ' ').trim();
  return [
    '*BESTELLING #' + CODE + '*',
    '',
    '*' + regel + '*',
    '',
    'Naam: ' + (naam() || '-'),
    '',
    'Hoi! Ik wil dit graag bestellen. Wat kost het en wanneer kan ik het hebben?'
  ].join('\n');
}

// Elke bestelling gaat ook versleuteld naar de Bestellingen-app (via ntfy.sh). Alleen die app kan hem lezen.
const K = window.KOPPELING || null;
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const vanB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let pubSleutel = null, ecSleutel = null;
async function versleutel(tekst) {
  if (!pubSleutel) pubSleutel = await crypto.subtle.importKey('spki', vanB64(K.pub), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(tekst));
  const k = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubSleutel, await crypto.subtle.exportKey('raw', aes));
  const uit = { k: b64(k), iv: b64(iv), d: b64(d) };
  // Tweede kopie voor de live-pagina op je telefoon (korte EC-sleutel).
  if (K.ecpub) {
    if (!ecSleutel) ecSleutel = await crypto.subtle.importKey('raw', vanB64(K.ecpub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const gedeeld = await crypto.subtle.deriveKey({ name: 'ECDH', public: ecSleutel }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv2 = crypto.getRandomValues(new Uint8Array(12));
    uit.e = b64(await crypto.subtle.exportKey('raw', eph.publicKey));
    uit.iv2 = b64(iv2);
    uit.d2 = b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, gedeeld, new TextEncoder().encode(tekst)));
  }
  return JSON.stringify(uit);
}
const klaar = new Map();   // kaart -> { tekst, body } (vooraf versleuteld, zodat de klik meteen kan versturen)
function voorbereiden(kaart, tekst) {
  if (!K || !window.crypto || !crypto.subtle) return;
  const huidig = klaar.get(kaart);
  if (huidig && huidig.tekst === tekst) return;
  const item = { tekst, body: null };
  klaar.set(kaart, item);
  versleutel(tekst).then(b => { item.body = b; }).catch(() => {});
}
// Rem: hoogstens 5 bestellingen per 10 minuten vanaf hetzelfde apparaat naar je app/telefoon.
function magVersturen() {
  try {
    const nu = Date.now(), l = JSON.parse(localStorage.getItem('verstuurd') || '[]').filter(t => nu - t < 600e3);
    if (l.length >= 5) return false;
    l.push(nu); localStorage.setItem('verstuurd', JSON.stringify(l));
  } catch (e) {}
  return true;
}
function verstuur(kaart) {
  if (!K || !magVersturen()) return;
  const item = klaar.get(kaart), tekst = bericht(kaart);
  const post = body => fetch(K.url + '/' + K.topic, { method: 'POST', body, keepalive: true }).catch(() => {});
  if (item && item.tekst === tekst && item.body) post(item.body);
  else if (K) versleutel(tekst).then(post).catch(() => {});
  // Pushmelding op je telefoon (ntfy-app). Zonder naam van de klant.
  // Bewust weinig info: wie het kanaal vindt, ziet alleen dat er een bestelling is, niet wat of van wie.
  if (K && K.meld) {
    fetch(K.url, { method: 'POST', keepalive: true, body: JSON.stringify({
      topic: K.meld, title: 'Snelbestellen', message: 'Nieuwe bestelling #' + CODE + ' - kijk in je app of WhatsApp', priority: 4
    }) }).catch(() => {});
  }
  setTimeout(() => { CODE = nieuweCode(); bijwerken(); }, 1500);   // volgende bestelling krijgt een nieuwe code
}

function bijwerken() {
  document.querySelectorAll('.bestel').forEach(k => {
    const kaart = k.closest('.product'), tekst = bericht(kaart);
    k.href = waLink(tekst);
    voorbereiden(kaart, tekst);
  });
  const vraag = 'Hoi! Ik heb een vraag over een bestelling.' + (naam() ? '\nNaam: ' + naam() : '');
  document.querySelectorAll('.wa-vraag').forEach(a => a.href = waLink(vraag));
}

document.querySelectorAll('.opties').forEach(groep => {
  groep.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    groep.querySelectorAll('button').forEach(b => b.classList.toggle('aan', b === e.target));
    bijwerken();
  });
});
document.querySelectorAll('.bestel').forEach(knop => {
  knop.innerHTML = WA + knop.textContent.replace(/^WA /, '');
  knop.addEventListener('click', () => verstuur(knop.closest('.product')));
});
document.addEventListener('input', bijwerken);
document.addEventListener('change', bijwerken);
naamVeld.addEventListener('input', () => { try { localStorage.setItem('naam', naam()); } catch (e) {} });

bijwerken();
