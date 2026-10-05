// Vue simplifiee (index.html): 4 rectangles + objectif annuel.
// Donnees: GET /api/simple (voir aggregate.getSimpleSummary).

const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const pctFmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const ICON_PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  contract: '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 13l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  cart: '<circle cx="9" cy="20" r="1.4" fill="currentColor"/><circle cx="17" cy="20" r="1.4" fill="currentColor"/><path d="M3 4h2l2.2 11h10.6L20 8H6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  arrowUp: '<path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowDown: '<path d="M12 5v13M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
};

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24">${ICON_PATHS[name] || ''}</svg>`;
}

function renderStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = iconSvg(el.dataset.icon);
  });
}

// ---------- Theme (meme cle localStorage que la vue complete) ----------
const THEME_STORAGE_KEY = 'proludik-theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggleIcon = document.querySelector('#themeToggle .nav-icon');
  if (toggleIcon) toggleIcon.innerHTML = iconSvg(theme === 'dark' ? 'sun' : 'moon');
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* navigation privee */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_STORAGE_KEY); } catch { /* ignore */ }
  applyTheme(saved === 'dark' ? 'dark' : 'light');
}

function initBrandLogo() {
  const img = document.getElementById('brandLogo');
  const fallback = document.getElementById('brandFallback');
  fallback.style.display = 'none';
  img.onerror = () => {
    img.style.display = 'none';
    fallback.style.display = 'flex';
  };
  img.src = 'assets/proludik_h_rouge_blanc.png';
}

function updateClock() {
  const now = new Date();
  document.getElementById('liveDate').textContent = now
    .toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase();
  document.getElementById('liveTime').textContent = now.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function deltaBadgeHtml(changePct) {
  if (changePct === null || Number.isNaN(changePct)) return '<span class="delta-badge muted">—</span>';
  const cls = changePct >= 0 ? 'up' : 'down';
  const icon = changePct >= 0 ? 'arrowUp' : 'arrowDown';
  return `<span class="delta-badge ${cls}"><span class="nav-icon">${iconSvg(icon)}</span>${pctFmt(changePct)}</span>`;
}

function cardHtml({ title, icon, variant, metric }) {
  const n = metric.current.count;
  return `
    <div class="simple-card ${variant}">
      <div class="simple-card-title"><span class="nav-icon">${iconSvg(icon)}</span>${title}</div>
      <div class="simple-card-value">${money.format(metric.current.amount)}</div>
      <div class="simple-card-count">${n} dossier${n > 1 ? 's' : ''}</div>
      <div class="simple-compare">
        <span>L'an dernier : <strong>${money.format(metric.previous.amount)}</strong></span>
        ${deltaBadgeHtml(metric.changePct)}
      </div>
    </div>`;
}

function objectiveHtml(obj, fiscalYear, previousFiscalYear) {
  if (obj.target === null) {
    return `<div><div class="objective-label">Objectif annuel ${fiscalYear}</div><div class="objective-target">Non configuré</div></div>`;
  }
  const pct = obj.pct || 0;
  const width = Math.min(100, Math.max(0, pct));
  const remaining = Math.max(0, obj.target - obj.amount);
  const pace = obj.toDateChangePct;
  const paceCls = pace === null ? '' : pace >= 0 ? 'up' : 'down';
  return `
    <div>
      <div class="objective-label">Objectif annuel ${fiscalYear}</div>
      <div class="objective-target">${money.format(obj.target)}</div>
    </div>
    <div class="objective-progress">
      <div class="objective-progress-text">
        <span>Confirmé : ${money.format(obj.amount)}</span>
        <strong>${pct.toFixed(0)} %</strong>
      </div>
      <div class="objective-track"><div class="objective-fill ${pct >= 100 ? 'good' : ''}" style="width:${width}%"></div></div>
      <div class="objective-progress-text"><span style="opacity:.75">${pct >= 100 ? 'Objectif atteint ✓' : `Reste ${money.format(remaining)}`}</span></div>
    </div>
    <div class="objective-pace">
      vs ${previousFiscalYear} à pareille date
      <span class="pace-value ${paceCls}">${pace === null ? '—' : pctFmt(pace)}</span>
      <span class="pace-sub">${money.format(obj.toDate)} vs ${money.format(obj.toDateLastYear)}</span>
    </div>`;
}

// Semaine fiscale: semaine 1 = semaine (lundi-dimanche) contenant le 1er
// octobre - meme numerotation que la vue complete (aggregate.fiscalWeekNumber).
function mondayOf(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

function renderFiscalStrip(fiscalYear) {
  const now = new Date();
  const fyStart = new Date(Number(fiscalYear.split('-')[0]), 9, 1);
  const week = Math.floor(Math.round((mondayOf(now) - mondayOf(fyStart)) / 86400000) / 7) + 1;
  const daysIn = Math.floor((now - fyStart) / 86400000);
  document.getElementById('fyYear').textContent = fiscalYear.replace('-', ' – ');
  document.getElementById('fyWeek').textContent = `Semaine ${week} de 52`;
  // Badge "Nouvelle année" visible le premier mois de l'annee financiere.
  document.getElementById('fyNew').hidden = daysIn > 31;
}

async function loadAll() {
  const data = await fetchJson('/api/simple');

  const [y1, y2] = data.fiscalYear.split('-');
  document.getElementById('fiscalRange').textContent = `1 OCT. ${y1} - 30 SEPT. ${y2}`;
  renderFiscalStrip(data.fiscalYear);
  document.getElementById('prevFyLabel').textContent = data.previousFiscalYear;
  document.getElementById('weekLabel').textContent = `(${data.lastWeek.contracts.label.toLowerCase()})`;
  document.getElementById('monthLabel').textContent = `(${data.currentMonth.contracts.label})`;

  document.getElementById('objectiveBanner').innerHTML = objectiveHtml(data.objective, data.fiscalYear, data.previousFiscalYear);

  document.getElementById('weekCards').innerHTML =
    cardHtml({ title: 'Contrats confirmés', icon: 'contract', variant: '', metric: data.lastWeek.contracts }) +
    cardHtml({ title: 'Ventes confirmées', icon: 'cart', variant: 'is-sales', metric: data.lastWeek.sales });

  document.getElementById('monthCards').innerHTML =
    cardHtml({ title: 'Contrats confirmés', icon: 'contract', variant: '', metric: data.currentMonth.contracts }) +
    cardHtml({ title: 'Ventes confirmées', icon: 'cart', variant: 'is-sales', metric: data.currentMonth.sales });

  try {
    const meta = await fetchJson('/api/meta');
    const times = Object.values(meta.sources || {}).map((s) => s.lastSuccessAt).filter(Boolean);
    const latest = times.length ? new Date(Math.max(...times.map((t) => new Date(t).getTime()))) : null;
    document.getElementById('lastUpdate').textContent = latest
      ? `Données mises à jour le ${latest.toLocaleDateString('fr-CA')} à ${latest.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`
      : 'Aucune donnée importée encore';
  } catch {
    /* pied de page seulement - pas bloquant */
  }
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

renderStaticIcons();
initTheme();
initBrandLogo();
updateClock();
setInterval(updateClock, 1000);

function safeLoad() {
  loadAll().catch((err) => {
    console.error(err);
    document.getElementById('weekCards').innerHTML = `<p style="color:var(--bad)">Erreur de chargement : ${err.message}</p>`;
  });
}
safeLoad();
// Rafraichit les chiffres aux 5 minutes (ecran d'affichage).
setInterval(safeLoad, 5 * 60 * 1000);
