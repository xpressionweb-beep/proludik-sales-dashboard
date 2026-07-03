const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
const pctFmt = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const CATEGORIES = [
  { key: 'Confirmé', label: 'Confirmé', varName: '--series-confirme', kind: 'io' },
  { key: 'Soumission', label: 'Soumission', varName: '--series-soumission', kind: 'io' },
  { key: 'Contrat/VFR', label: 'Contrat/VFR', varName: '--series-contrat', kind: 'io' },
  { key: 'Autre', label: 'Autre (IO)', varName: '--series-autre', kind: 'io' },
  { key: 'Shopify', label: 'Shopify', varName: '--series-shopify', kind: 'shopify' },
];

let chartPeriod = 'month';
let repPeriod = 'month';
let overviewData = null;

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function bucketsFromTotals(totals) {
  // Retourne les buckets a afficher, dans l'ordre fixe, en omettant "Autre" s'il est vide.
  return CATEGORIES.filter((c) => {
    if (c.key === 'Autre') {
      return totals.io.Autre && totals.io.Autre.amount > 0;
    }
    return true;
  }).map((c) => {
    const amount = c.kind === 'shopify' ? totals.shopify.amount : totals.io[c.key].amount;
    return { ...c, amount };
  });
}

function renderStatRow(overview) {
  const el = document.getElementById('statRow');
  const defs = [
    { type: 'week', title: 'Semaine en cours' },
    { type: 'month', title: 'Mois en cours' },
    { type: 'year', title: 'Année financière en cours' },
  ];

  el.innerHTML = defs
    .map(({ type, title }) => {
      const period = overview[type];
      const total = period.current.totals.grandTotal;
      const changePct = period.changePct;
      let deltaClass = 'flat';
      let deltaText = 'stable vs période précédente';
      if (changePct !== null) {
        deltaClass = changePct > 0.05 ? 'up' : changePct < -0.05 ? 'down' : 'flat';
        deltaText = `${pctFmt(changePct)} vs période précédente`;
      }
      return `
        <div class="stat-tile">
          <div class="label">${title}</div>
          <div class="value">${money.format(total)}</div>
          <div class="delta ${deltaClass}">${deltaText}</div>
        </div>`;
    })
    .join('');
}

function renderLegend(buckets) {
  const el = document.getElementById('legend');
  el.innerHTML = buckets
    .map(
      (b) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:var(${b.varName})"></span>${b.label}</span>`
    )
    .join('');
}

function renderPanel(title, totals, maxValue) {
  const buckets = bucketsFromTotals(totals);
  const rows = buckets
    .map((b) => {
      const widthPct = maxValue > 0 ? Math.max(2, (b.amount / maxValue) * 100) : 0;
      return `
        <div class="bar-row">
          <div class="cat-label">${b.label}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${widthPct}%; background:var(${b.varName})"></div>
          </div>
          <div class="bar-value">${money.format(b.amount)}</div>
        </div>`;
    })
    .join('');

  return `
    <div class="panel">
      <p class="panel-title">${title}</p>
      ${rows}
    </div>`;
}

function renderChartSection(overview, type) {
  const period = overview[type];
  const { current, previous, changePct } = period;

  const allBuckets = [...bucketsFromTotals(current.totals), ...bucketsFromTotals(previous.totals)];
  const maxValue = Math.max(1, ...allBuckets.map((b) => b.amount));

  document.getElementById('chartPanels').innerHTML =
    renderPanel(`Période actuelle — ${current.label}`, current.totals, maxValue) +
    renderPanel(`Période précédente — ${previous.label}`, previous.totals, maxValue);

  renderLegend(bucketsFromTotals(current.totals));

  const deltaEl = document.getElementById('deltaLine');
  if (changePct === null) {
    deltaEl.textContent = '';
  } else {
    const cls = changePct > 0.05 ? 'up' : changePct < -0.05 ? 'down' : '';
    deltaEl.innerHTML = `Total <strong>${money.format(current.totals.grandTotal)}</strong> vs <strong>${money.format(
      previous.totals.grandTotal
    )}</strong> (<span class="${cls}">${pctFmt(changePct)}</span>)`;
  }
}

async function renderReps(type) {
  const data = await fetchJson(`/api/reps?period=${type}&offset=0`);
  document.getElementById('repPeriodLabel').textContent = `${data.label} · Année financière ${data.fiscalYear}`;

  const el = document.getElementById('repList');
  if (!data.reps.length) {
    el.innerHTML = '<p class="muted small">Aucune vente sur cette période.</p>';
    return;
  }

  el.innerHTML = data.reps
    .map((r) => {
      const widthPct = r.pct !== null ? Math.min(100, Math.max(2, r.pct)) : 0;
      const fillClass = r.pct !== null && r.pct >= 100 ? 'rep-fill good' : 'rep-fill';
      const pctText = r.pct !== null ? `${r.pct.toFixed(0)}%` : '—';
      const targetText = r.target !== null ? ` / objectif ${money.format(r.target)}` : ' (aucun objectif configuré)';
      return `
        <div class="rep-row">
          <div class="rep-name">${r.rep}</div>
          <div class="rep-track"><div class="${fillClass}" style="width:${widthPct}%"></div></div>
          <div class="rep-numbers"><span class="pct">${pctText}</span><br>${money.format(r.amount)}${targetText}</div>
        </div>`;
    })
    .join('');
}

function renderSyncBadges(meta) {
  const el = document.getElementById('syncBadges');
  const sources = [
    { key: 'shopify', label: 'Shopify' },
    { key: 'io', label: 'InflatableOffice' },
  ];

  el.innerHTML = sources
    .map(({ key, label }) => {
      const info = meta.sources[key] || {};
      const isMock = meta.mock[key];
      const hasError = Boolean(info.lastError);
      const dotClass = hasError ? 'err' : isMock ? 'mock' : 'ok';
      const when = info.lastSuccessAt ? new Date(info.lastSuccessAt).toLocaleString('fr-CA') : 'jamais';
      const suffix = isMock ? ' (mode démo)' : hasError ? ` — erreur: ${info.lastError}` : '';
      return `<span class="sync-badge"><span class="dot ${dotClass}"></span>${label} · ${when}${suffix}</span>`;
    })
    .join('');
}

function setupTabs(containerId, onChange) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    container.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
    btn.classList.add('is-active');
    onChange(btn.dataset.period);
  });
}

async function loadAll() {
  const [overview, meta] = await Promise.all([fetchJson('/api/overview'), fetchJson('/api/meta')]);
  overviewData = overview;
  renderStatRow(overview);
  renderChartSection(overview, chartPeriod);
  renderSyncBadges(meta);
  await renderReps(repPeriod);
}

setupTabs('periodTabs', (type) => {
  chartPeriod = type;
  if (overviewData) renderChartSection(overviewData, chartPeriod);
});

setupTabs('repPeriodTabs', (type) => {
  repPeriod = type;
  renderReps(repPeriod);
});

document.getElementById('syncNowBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Synchronisation…';
  try {
    await fetchJson('/api/sync', { method: 'POST' });
    await loadAll();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Synchroniser maintenant';
  }
});

loadAll().catch((err) => {
  console.error(err);
  document.querySelector('main').insertAdjacentHTML(
    'afterbegin',
    `<p style="color:#d03b3b">Erreur de chargement du dashboard: ${err.message}</p>`
  );
});
