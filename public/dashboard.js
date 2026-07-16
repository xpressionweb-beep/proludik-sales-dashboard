const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const pctFmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const num = new Intl.NumberFormat('fr-CA');

// ---------- Icones (SVG minimalistes, trait = currentColor) ----------
const ICON_PATHS = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  chart: '<path d="M4 20V10M11 20V4M18 20v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  users: '<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 8a3 3 0 110 0M15 14c2.8.3 5 2.8 5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  funnel: '<path d="M4 5h16l-6 7v6l-4 2v-8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  truck: '<path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.6" fill="currentColor"/><circle cx="17" cy="18" r="1.6" fill="currentColor"/>',
  cart: '<circle cx="9" cy="20" r="1.4" fill="currentColor"/><circle cx="17" cy="20" r="1.4" fill="currentColor"/><path d="M3 4h2l2.2 11h10.6L20 8H6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  megaphone: '<path d="M3 10v4h3l6 4V6L6 10H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M17 9a4 4 0 010 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  doc: '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12h6M9 16h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  contract: '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 13l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  dollar: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 6v12M15 9.5c0-1.4-1.3-2.2-3-2.2s-3 .9-3 2.1c0 3 6 1.4 6 4.4 0 1.3-1.3 2.2-3 2.2s-3-.9-3-2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
  trendUp: '<path d="M4 16l6-6 4 4 6-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 6h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  soumission: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
  vrf: '<path d="M4 20l2-6 10-10 4 4-10 10-6 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  arrowUp: '<path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowDown: '<path d="M12 5v13M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  alertTriangle: '<path d="M12 4l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="17" r="0.9" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  facebook: '<path d="M14.5 8.5H13c-.3 0-.5.2-.5.5v2h2.3l-.3 2.3H12.5V21h-2.4v-7.7H8.3v-2.3h1.8V9c0-2 1.4-3.6 3.4-3.6h2z" fill="currentColor"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.6" cy="7.4" r="1" fill="currentColor"/>',
};

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24">${ICON_PATHS[name] || ''}</svg>`;
}

function renderStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = iconSvg(el.dataset.icon);
  });
}

// ---------- Theme clair/sombre ----------
// Meme structure et memes donnees dans les deux themes - seules les
// couleurs (variables CSS) changent. Prefere localStorage a
// prefers-color-scheme: c'est un choix explicite de l'utilisateur via le
// bouton, pas un suivi automatique du systeme.
const THEME_STORAGE_KEY = 'proludik-theme';
// La colonne de gauche (sidebar) reste toujours bleu Proludik (voir
// styles.css), donc le logo utilise reste lui aussi fixe (le logo "initial",
// blanc/rouge, pense pour un fond fonce) - il ne bascule plus avec le theme.
const BRAND_LOGO_PATH = 'assets/proludik_h_rouge_blanc.png';

function initBrandLogo() {
  const img = document.getElementById('brandLogo');
  const fallback = document.getElementById('brandFallback');
  img.style.display = '';
  fallback.style.display = 'none';
  img.onerror = () => {
    img.style.display = 'none';
    fallback.style.display = 'flex';
  };
  img.src = BRAND_LOGO_PATH;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggleIcon = document.querySelector('#themeToggle .nav-icon');
  if (toggleIcon) toggleIcon.innerHTML = iconSvg(theme === 'dark' ? 'sun' : 'moon');
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

// ---------- Horloge / date en direct ----------
function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  const timeStr = now.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('liveDate').textContent = dateStr;
  document.getElementById('liveTime').textContent = timeStr;
}

// ---------- Fetch helper ----------
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function repInitials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function deltaBadgeHtml(changePct) {
  if (changePct === null || Number.isNaN(changePct)) return '<span class="delta-badge muted">—</span>';
  const cls = changePct >= 0 ? 'up' : 'down';
  const icon = changePct >= 0 ? 'arrowUp' : 'arrowDown';
  return `<span class="delta-badge ${cls}"><span class="nav-icon" style="width:12px;height:12px">${iconSvg(icon)}</span>${pctFmt(changePct)}</span>`;
}

// ---------- Paliers de couleur (vert/jaune/rouge) ----------
// Reutilise partout ou une valeur se compare a un seuil de 100%: score des
// representants, cartes compteurs (ratio vs periode precedente), etc.
// vert >= 100%, jaune 75-99%, rouge < 75%, gris si aucune comparaison
// possible (pas de donnee de reference).
function tierClass(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 'neutral';
  if (pct >= 100) return 'good';
  if (pct >= 75) return 'warn';
  return 'bad';
}

function tierColorVar(tier) {
  return { good: 'var(--good)', warn: 'var(--warning)', bad: 'var(--bad)', neutral: 'var(--text-muted)' }[tier];
}

function tierDotHtml(tier) {
  const title = { good: 'Objectif atteint', warn: 'Proche de l\'objectif', bad: 'En dessous de l\'objectif', neutral: 'Pas encore de comparaison' }[tier];
  return `<span class="status-dot ${tier}" title="${title}"></span>`;
}

// Ratio "periode courante / periode precedente" en %, utilise pour colorer
// les cartes Confirmes/Soumissions/VRF-Contrats (100% = au moins autant que
// la periode precedente).
function ratioPct(current, previous) {
  if (previous > 0) return (current / previous) * 100;
  return current > 0 ? 100 : null;
}

function sparklineHtml(points, { showLabels = false } = {}) {
  const max = Math.max(1, ...points.map((p) => p.amount));
  const bars = points
    .map((p) => `<div class="bar${p.current ? ' is-current' : ''}" style="height:${Math.max(4, (p.amount / max) * 100)}%" title="${p.label}: ${money.format(p.amount)}"></div>`)
    .join('');
  const labels = showLabels
    ? `<div class="sparkline-labels">${points.map((p) => `<span class="${p.current ? 'is-current' : ''}">${p.label}</span>`).join('')}</div>`
    : '';
  return `<div class="sparkline">${bars}</div>${labels}`;
}

// ---------- Bandeau de metriques rapides ----------
async function renderQuickMetrics() {
  const overview = await fetchJson('/api/overview');
  const day = overview.day;
  const ioCountToday = Object.values(day.current.totals.io).reduce((s, b) => s + b.count, 0);
  const salesToday = day.current.totals.grandTotal;
  const changePct = day.changePct;

  const items = [
    { icon: 'contract', value: num.format(ioCountToday), label: 'Contrats aujourd\'hui' },
    { icon: 'dollar', value: money.format(salesToday), label: 'Ventes aujourd\'hui' },
    { icon: 'trendUp', value: changePct === null ? '—' : pctFmt(changePct), label: 'vs hier' },
    { icon: 'alertTriangle', value: null, label: 'Soumissions sans suivi' },
    { icon: 'clock', value: null, label: 'Paiements en retard' },
    { icon: 'vrf', value: null, label: 'Livraisons complétées' },
  ];

  document.getElementById('quickMetrics').innerHTML = items
    .map(
      (it) => `
      <div class="qm-item">
        <div class="qm-icon">${iconSvg(it.icon)}</div>
        <div>
          <div class="qm-value ${it.value === null ? 'is-placeholder' : ''}">${it.value === null ? 'Bientôt disponible' : it.value}</div>
          <div class="qm-label">${it.label}</div>
        </div>
      </div>`
    )
    .join('');
}

// ---------- Grandes cartes ----------
async function renderBigCards() {
  const [yoy, objective, trendWeek, trendMonth, trendYear] = await Promise.all([
    fetchJson('/api/yoy'),
    fetchJson('/api/objective'),
    fetchJson('/api/trend?card=week'),
    fetchJson('/api/trend?card=month'),
    fetchJson('/api/trend?card=year'),
  ]);

  const yoyCard = (title, icon, data, trend, showLabels) => {
    const targetLine =
      data.target !== undefined
        ? `<div class="goal-progress-text"><span>Objectif : ${data.target !== null ? money.format(data.target) : 'à venir'}</span>${data.pct !== null ? `<strong>${data.pct.toFixed(0)}%</strong>` : ''}</div>`
        : '';
    return `
    <div class="big-card">
      <div class="big-card-title">${iconSvg(icon) ? `<span class="nav-icon">${iconSvg(icon)}</span>` : ''}${title}</div>
      <div class="big-card-value">${money.format(data.current.totals.grandTotal)}</div>
      ${targetLine}
      <div class="big-card-compare">
        <span class="compare-years">vs même période l'an dernier : <strong>${money.format(data.previousYear.totals.grandTotal)}</strong></span>
        ${deltaBadgeHtml(data.changePct)}
      </div>
      ${sparklineHtml(trend, { showLabels })}
    </div>`;
  };

  const objectivePct = objective.pct !== null ? Math.min(100, Math.max(0, objective.pct)) : 0;
  const remaining = objective.target !== null ? Math.max(0, objective.target - objective.amount) : null;
  const isGood = objective.pct !== null && objective.pct >= 100;

  const objectiveCard = `
    <div class="big-card">
      <div class="big-card-title"><span class="nav-icon">${iconSvg('vrf')}</span>Objectif annuel</div>
      <div class="big-card-value">${objective.target !== null ? money.format(objective.target) : 'Non configuré'}</div>
      <div class="goal-progress-text"><span>Atteint</span><strong>${objective.pct !== null ? objective.pct.toFixed(0) : '—'}%</strong></div>
      <div class="goal-progress-track"><div class="goal-progress-fill ${isGood ? 'good' : ''}" style="width:${objectivePct}%"></div></div>
      <div class="big-card-compare">
        <span class="compare-years">${
          objective.target === null
            ? 'Objectif non configuré (config/objectifs.json)'
            : isGood
            ? 'Objectif atteint ✓'
            : `${money.format(remaining)} à atteindre`
        }</span>
      </div>
    </div>`;

  document.getElementById('bigCards').innerHTML =
    yoyCard('Semaine dernière', 'chart', yoy.week, trendWeek, false) +
    // "Ce mois": 5 semaines (2 precedentes, en cours, 2 suivantes) -
    // numeros de semaine affiches sous le graphique (voir getTrend cote
    // serveur pour le detail des semaines calendaires retenues).
    yoyCard('Ce mois', 'calendar', yoy.month, trendMonth, true) +
    // "Année financière": 13 mois civils (6 precedents, en cours, 6
    // suivants) affiches sous le graphique.
    yoyCard('Année financière', 'dollar', yoy.year, trendYear, true) +
    objectiveCard;
}

// ---------- Compteurs de statut ----------
// Confirmés/Soumissions/VRF-Contrats: comptes sur une fenetre glissante de
// 7 jours (pas l'annee financiere) - voir getStatusCounts7d() cote
// serveur pour le detail exact de ce que compte chaque statut (en
// particulier pourquoi "Soumissions" ne compte que les soumissions
// encore ouvertes, sans logique de filtrage supplementaire necessaire).
async function renderCounters() {
  const [counts7d, conversionSummary] = await Promise.all([
    fetchJson('/api/status-counts-7d'),
    fetchJson('/api/rep-conversion-summary'),
  ]);

  const defs = [
    { key: 'Confirmé', label: 'Confirmés', icon: 'contract' },
    { key: 'Soumission', label: 'Soumissions', icon: 'soumission' },
    { key: 'Contrat/VFR', label: 'VRF / Contrats', icon: 'vrf' },
  ];

  const statusCards = defs
    .map(({ key, label, icon }) => {
      const s = counts7d.statuses[key];
      // Palier vert/jaune/rouge base sur le ratio "7 derniers jours / 7
      // jours precedents" (100% = au moins autant que la periode
      // precedente) - pas de comparaison possible (gris) si les deux
      // periodes sont a 0.
      const tier = tierClass(ratioPct(s.current, s.previous));
      return `
        <div class="counter-card">
          <div class="counter-title"><span class="nav-icon">${iconSvg(icon)}</span>${label}${tierDotHtml(tier)}</div>
          <div class="counter-value">${num.format(s.current)}</div>
          <div class="counter-compare">${money.format(s.amount)} · vs ${num.format(s.previous)} (7 jours précédents) ${deltaBadgeHtml(s.changePct)}</div>
        </div>`;
    })
    .join('');

  const avg = conversionSummary.average;
  const conversionTier = tierClass(avg);
  const conversionCard = `
    <div class="counter-card">
      <div class="counter-title"><span class="nav-icon">${iconSvg('trendUp')}</span>Conversion moyenne${tierDotHtml(conversionTier)}</div>
      <div class="counter-value">${avg !== null ? avg.toFixed(0) + '%' : '—'}</div>
      <div class="counter-compare">Moyenne de ${conversionSummary.repCount} représentants (année financière)</div>
    </div>`;

  document.getElementById('counters').innerHTML = statusCards + conversionCard;
}

// ---------- Tableau de performance des representants ----------
function scoreRingHtml(pct) {
  const clamped = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  const tier = tierClass(pct);
  const deg = clamped * 3.6;
  return `
    <div class="score-ring" style="background: conic-gradient(${tierColorVar(tier)} ${deg}deg, var(--track) 0)">
      <div class="score-ring-inner">${pct !== null ? Math.round(pct) : '—'}</div>
    </div>`;
}

function progressCellHtml(pct) {
  const clamped = pct === null ? 0 : Math.min(100, Math.max(2, pct));
  const tier = tierClass(pct);
  return `
    <div class="mini-progress-track"><div class="mini-progress-fill ${tier}" style="width:${clamped}%"></div></div>
    <div class="progress-pct">${pct !== null ? pct.toFixed(0) + '%' : '—'}</div>`;
}

async function renderRepTable() {
  const data = await fetchJson('/api/reps?period=year&offset=0');
  const rows = [];

  for (const r of data.reps) {
    rows.push(`
      <tr>
        <td><div class="rep-name-cell"><span class="rep-avatar">${repInitials(r.rep)}</span>${r.rep}</div></td>
        <td class="num-cell">${money.format(r.byStatus['Confirmé'])}</td>
        <td class="num-cell">${money.format(r.byStatus['Soumission'])}</td>
        <td class="num-cell">${money.format(r.byStatus['Contrat/VFR'])}</td>
        <td class="num-cell">${r.conversion !== null ? r.conversion.toFixed(0) + '%' : '—'}</td>
        <td class="num-cell">${r.target !== null ? money.format(r.target) : '—'}</td>
        <td class="progress-cell">${progressCellHtml(r.pct)}</td>
        <td>${scoreRingHtml(r.pct)}</td>
      </tr>`);
  }

  // Ligne "Web" (Shopify) - categorie distincte, pas de repartition par
  // statut IO (Confirme/Soumission/VRF ne s'appliquent pas a Shopify).
  const s = data.shopify;
  rows.push(`
    <tr>
      <td><div class="rep-name-cell"><span class="rep-avatar" style="background:var(--brand-red)">WEB</span>Boutique Shopify</div></td>
      <td class="num-cell" title="Total des ventes Shopify (pas de statut par vente)">${money.format(s.amount)}</td>
      <td class="num-cell">—</td>
      <td class="num-cell">—</td>
      <td class="num-cell">—</td>
      <td class="num-cell">${s.target !== null ? money.format(s.target) : '—'}</td>
      <td class="progress-cell">${progressCellHtml(s.pct)}</td>
      <td>${scoreRingHtml(s.pct)}</td>
    </tr>`);

  document.getElementById('repTableBody').innerHTML = rows.join('');
}

async function renderNewDossiers() {
  const data = await fetchJson('/api/new-dossiers-7d');

  document.getElementById('newDossiers').innerHTML = data.divisions
    .map((d) => {
      const tier = tierClass(ratioPct(d.current, d.previous));
      return `
        <div class="counter-card">
          <div class="counter-title">${d.name}${tierDotHtml(tier)}</div>
          <div class="counter-value">${num.format(d.current)}</div>
          <div class="counter-compare">${money.format(d.amount)} · vs ${num.format(d.previous)} (${money.format(d.previousAmount)}) 7 jours précédents ${deltaBadgeHtml(d.changePct)}</div>
        </div>`;
    })
    .join('');
}

// ---------- Fenetres par division (Location/Fabrication/Reparation/Vente + Global) ----------
async function renderDivisions() {
  const data = await fetchJson('/api/divisions');

  const cardHtml = (d) => {
    const tier = tierClass(d.pct);
    return `
      <div class="counter-card division-card${d.name === 'Global' ? ' division-card-global' : ''}">
        <div class="counter-title">${d.name}${tierDotHtml(tier)}</div>
        <div class="division-value-row">
          <div class="counter-value">${money.format(d.total)}</div>
          ${scoreRingHtml(d.pct)}
        </div>
        <div class="counter-compare">Objectif : <strong>${d.target !== null ? money.format(d.target) : 'à venir'}</strong>${d.pct !== null ? ` (${d.pct.toFixed(0)}%)` : ''}</div>
        <div class="counter-compare">Semaine dernière : <strong>${money.format(d.lastWeek)}</strong></div>
      </div>`;
  };

  document.getElementById('divisions').innerHTML = data.divisions.map(cardHtml).join('') + cardHtml(data.global);
}

// ---------- Ventes par mois (annee courante vs annee precedente) ----------
function pctCellHtml(pct) {
  if (pct === null) return '<td class="num-cell">—</td>';
  const tier = tierClass(pct);
  return `<td class="num-cell">${pct.toFixed(0)}%${tierDotHtml(tier)}</td>`;
}

async function renderMonthlySalesTable() {
  const data = await fetchJson('/api/monthly-sales-table');

  document.getElementById('monthlySalesFyCur').textContent = data.fiscalYear;
  document.getElementById('monthlySalesFyPrev').textContent = data.previousFiscalYear;

  const rows = data.rows
    .map(
      (r) => `
      <tr>
        <td>${r.label}</td>
        <td class="num-cell">${money.format(r.location)}</td>
        <td class="num-cell">${money.format(r.fabrication)}</td>
        <td class="num-cell">${money.format(r.reparation)}</td>
        <td class="num-cell">${money.format(r.vente)}</td>
        <td class="num-cell io-subtotal-cell">${money.format(r.ioSubtotal)}</td>
        <td class="num-cell">${r.changePct !== null ? pctFmt(r.changePct) : '—'}</td>
        <td class="num-cell">${r.target !== null ? money.format(r.target) : '—'}</td>
        ${pctCellHtml(r.pct)}
      </tr>`
    )
    .join('');

  const t = data.total;
  const totalRow = `
    <tr class="monthly-sales-total">
      <td>Total général</td>
      <td class="num-cell">${money.format(t.location)}</td>
      <td class="num-cell">${money.format(t.fabrication)}</td>
      <td class="num-cell">${money.format(t.reparation)}</td>
      <td class="num-cell">${money.format(t.vente)}</td>
      <td class="num-cell io-subtotal-cell">${money.format(t.ioSubtotal)}</td>
      <td class="num-cell">${t.changePct !== null ? pctFmt(t.changePct) : '—'}</td>
      <td class="num-cell">${t.target !== null ? money.format(t.target) : '—'}</td>
      ${pctCellHtml(t.pct)}
    </tr>`;

  document.getElementById('monthlySalesTableBody').innerHTML = rows + totalRow;
}

// ---------- Activite recente (donnees reelles) ----------
function timeAgoOrDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
}

async function renderActivity() {
  const items = await fetchJson('/api/activity?limit=8');
  const el = document.getElementById('activityList');

  if (!items.length) {
    el.innerHTML = '<p class="muted small">Aucune vente enregistrée pour le moment.</p>';
    return;
  }

  el.innerHTML = items
    .map((it) => {
      const isShopify = it.source === 'shopify';
      const icon = isShopify ? 'cart' : it.status === 'Confirmé' ? 'contract' : it.status === 'Soumission' ? 'soumission' : 'vrf';
      const title = isShopify ? 'Commande Shopify' : it.status;
      const sub = it.rep ? it.rep : isShopify ? 'Boutique en ligne' : 'Représentant non assigné';
      return `
        <li class="activity-item">
          <div class="activity-icon">${iconSvg(icon)}</div>
          <div class="activity-body">
            <div class="activity-row-top">
              <span class="activity-title">${title}</span>
              <span class="activity-amount">${money.format(it.amount)}</span>
            </div>
            <div class="activity-row-top">
              <span class="activity-sub">${sub}</span>
              <span class="activity-time">${timeAgoOrDate(it.orderDate)}</span>
            </div>
          </div>
        </li>`;
    })
    .join('');
}

// ---------- Reseaux sociaux ----------
function socialCardHtml({ icon, iconClass, name, stats }) {
  if (stats.error) {
    return `
      <div class="social-card">
        <div class="social-card-header">
          <span class="social-icon ${iconClass}">${iconSvg(icon)}</span>
          <span class="social-name">${name}</span>
        </div>
        <p class="muted small">Erreur: ${stats.error}</p>
      </div>`;
  }

  const growthCls = stats.followersGrowthPct7d >= 0 ? 'up' : 'down';
  const growthIcon = stats.followersGrowthPct7d >= 0 ? 'arrowUp' : 'arrowDown';

  return `
    <div class="social-card">
      <div class="social-card-header">
        <span class="social-icon ${iconClass}">${iconSvg(icon)}</span>
        <span class="social-name">${name}</span>
        ${stats.mock ? '<span class="live-dot is-mock"><span class="dot"></span>Mode démo</span>' : '<span class="live-dot"><span class="dot"></span>Données réelles</span>'}
      </div>
      <div>
        <span class="social-followers">${num.format(stats.followers)}</span>
        <span class="social-followers-label">abonnés</span>
      </div>
      <div class="social-metrics-row">
        <div class="social-metric">
          <span class="delta-badge ${growthCls}"><span class="nav-icon" style="width:12px;height:12px">${iconSvg(growthIcon)}</span>${pctFmt(stats.followersGrowthPct7d)}</span>
          <span>Croissance (7 jours)</span>
        </div>
        <div class="social-metric">
          <span class="social-metric-value">${num.format(stats.engagement7d)}</span>
          <span>Engagement (7 jours)</span>
        </div>
      </div>
    </div>`;
}

async function renderSocial() {
  const { facebook, instagram } = await fetchJson('/api/social');
  document.getElementById('socialGrid').innerHTML =
    socialCardHtml({ icon: 'facebook', iconClass: 'facebook', name: 'Facebook', stats: facebook }) +
    socialCardHtml({ icon: 'instagram', iconClass: 'instagram', name: 'Instagram', stats: instagram });
}

// ---------- Meta / sync ----------
async function renderMeta() {
  const meta = await fetchJson('/api/meta');
  const sources = [
    { key: 'shopify', label: 'Shopify' },
    { key: 'io', label: 'InflatableOffice' },
  ];

  document.getElementById('syncBadges').innerHTML = sources
    .map(({ key, label }) => {
      const info = meta.sources[key] || {};
      const isMock = meta.mock[key];
      const hasError = Boolean(info.lastError);
      const suffix = isMock ? ' (mode démo)' : hasError ? ` — erreur` : '';
      return `${label}${suffix}`;
    })
    .join(' · ');

  const lastTimes = sources.map(({ key }) => meta.sources[key] && meta.sources[key].lastSuccessAt).filter(Boolean);
  const latest = lastTimes.length ? new Date(Math.max(...lastTimes.map((t) => new Date(t).getTime()))) : null;
  document.getElementById('lastUpdate').textContent = latest
    ? `Données mises à jour à ${latest.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}`
    : 'Aucune synchronisation encore';

  // Badge "Données réelles/Mode démo": affiché dans le pied de page,
  // reflete specifiquement le mode IO (bouton Réel/Démo du header), pas un
  // "OU" avec Shopify - sinon le badge resterait bloque sur "Mode démo"
  // tant que Shopify n'a pas de vraies cles, meme quand on bascule IO sur
  // "Réel" (le statut de Shopify reste visible separement dans le pied de
  // page, ci-dessus). L'élément activityBadge (carte "Activité récente")
  // a été retiré du dashboard - ce badge n'existe donc plus ici.
}

// ---------- Annee financiere (haut a droite) ----------
async function renderFiscalRange() {
  const objective = await fetchJson('/api/objective');
  const [y1, y2] = objective.fiscalYear.split('-');
  document.getElementById('fiscalRange').textContent = `1 OCT. ${y1} - 30 SEPT. ${y2}`;
}

// ---------- Bouton Réel/Démo (donnees IO) ----------
// Contrairement au theme, ceci change un vrai comportement serveur (quelle
// source de donnees IO utiliser) - l'etat vit cote serveur
// (server/runtimeSettings.js, persiste sur disque), pas juste dans le
// navigateur. localStorage n'est utilise nulle part ici.
function renderIoModeButton(mode) {
  const btn = document.getElementById('ioModeToggle');
  btn.classList.toggle('is-demo', mode === 'demo');
  document.getElementById('ioModeText').textContent = mode === 'demo' ? 'Démo' : 'Réel';
  btn.disabled = false;
}

// Si le serveur avait deja une sync en cours (ex: bloquee sur un timeout
// IO), la nouvelle demande est mise en file d'attente cote serveur - voir
// scheduler.js - et se declenchera automatiquement, mais pas assez vite
// pour qu'on attende la reponse HTTP (voir triggerSyncQuick dans
// server/routes/api.js). On previent l'utilisateur plutot que de faire
// comme si tout etait deja a jour.
let queuedNoticeTimer = null;
function showQueuedNotice() {
  const notice = document.getElementById('queuedNotice');
  const sep = document.getElementById('queuedSep');
  notice.textContent = 'Une synchronisation était déjà en cours — celle-ci se déclenchera automatiquement à la suite (données pas encore à jour).';
  notice.hidden = false;
  sep.hidden = false;
  clearTimeout(queuedNoticeTimer);
  queuedNoticeTimer = setTimeout(() => {
    notice.hidden = true;
    sep.hidden = true;
  }, 20000);
}

async function initIoModeToggle() {
  const btn = document.getElementById('ioModeToggle');
  const { mode } = await fetchJson('/api/settings/io-mode');
  renderIoModeButton(mode);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const nextMode = btn.classList.contains('is-demo') ? 'real' : 'demo';
    try {
      const result = await fetchJson('/api/settings/io-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      renderIoModeButton(result.mode);
      if (result.queued) showQueuedNotice();
      await loadAll();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
    }
  });
}

async function loadAll() {
  await Promise.all([
    renderBigCards(),
    renderNewDossiers(),
    renderDivisions(),
    renderRepTable(),
    renderMonthlySalesTable(),
    renderSocial(),
    renderMeta(),
    renderFiscalRange(),
  ]);
  renderStaticIcons();
}

document.getElementById('syncNowBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Synchronisation…';
  try {
    const result = await fetchJson('/api/sync', { method: 'POST' });
    if (result.queued) showQueuedNotice();
    await loadAll();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Synchroniser maintenant';
  }
});

// Force une resynchronisation complete Shopify (efface la derniere sync
// cote serveur pour repartir de SHOPIFY_INITIAL_SYNC_DAYS - voir POST
// /api/admin/reset-sync dans server/routes/api.js). Confirmation demandee
// car c'est une action plus lourde qu'un sync normal (re-fetch tout
// l'historique), pas juste les nouvelles commandes.
document.getElementById('resetShopifySyncBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const confirmed = window.confirm(
    'Resynchroniser Shopify depuis le début (tout l\'historique, pas juste les nouvelles commandes) ? Ça peut prendre plus de temps qu\'un sync normal.'
  );
  if (!confirmed) return;

  btn.disabled = true;
  btn.textContent = 'Resynchronisation…';
  try {
    const result = await fetchJson('/api/admin/reset-sync?source=shopify', { method: 'POST' });
    if (result.queued) showQueuedNotice();
    await loadAll();
  } catch (err) {
    console.error(err);
    window.alert(`Échec de la resynchronisation Shopify: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Resynchroniser Shopify (complet)';
  }
});

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

renderStaticIcons();
initTheme();
initBrandLogo();
updateClock();
setInterval(updateClock, 1000);
initIoModeToggle().catch((err) => console.error('Impossible de charger le mode IO (Réel/Démo):', err));

loadAll().catch((err) => {
  console.error(err);
  document.querySelector('main').insertAdjacentHTML(
    'afterbegin',
    `<p style="color:#e6394a">Erreur de chargement du dashboard: ${err.message}</p>`
  );
});
