// Courriel envoyé à un représentant avec sa mission de la semaine.
// HTML en tableaux + styles en ligne: c'est ce qu'Outlook affiche le mieux.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function frDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function missionEmail({ rep, defi, bilan }) {
  const titre = [defi.l1, defi.l2].filter(Boolean).join(' ');
  const subject = `Le Boost : ta mission de la semaine, ${titre}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;font-family:Arial,Helvetica,sans-serif;color:#1a2744">
  <tr><td style="padding:0 4px 14px;font-size:16px">Salut ${esc(rep.nom)},</td></tr>
  <tr><td style="padding:0 4px 18px;font-size:15px;line-height:1.5">Voici la mission que tu as pigée à la réunion Le Boost. Bonne chasse!</td></tr>
  <tr><td style="background:#ffffff;border:2px solid #dfe3ee;border-radius:12px;overflow:hidden">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:#1a2744;padding:14px 18px;color:#ffffff;font-size:15px;font-weight:bold;letter-spacing:2px">
        <span style="display:inline-block;background:#e3263a;color:#fff;border-radius:50%;width:34px;height:34px;line-height:34px;text-align:center;font-size:18px;margin-right:10px">${esc(defi.num)}</span>MISSION
      </td></tr>
      <tr><td style="padding:20px 18px 8px;font-size:28px;font-weight:bold;line-height:1.05;text-transform:uppercase;color:#1a2744">${esc(defi.l1)}${defi.l2 ? `<br><span style="color:#e3263a">${esc(defi.l2)}</span>` : ''}</td></tr>
      <tr><td style="padding:6px 18px 22px;font-size:16px;line-height:1.5;color:#2a3350">${esc(defi.desc)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:18px 4px 0;font-size:14px;line-height:1.5;color:#5b6582">On fait le bilan à la réunion du <strong style="color:#1a2744">${esc(frDate(bilan))}</strong>.</td></tr>
  <tr><td style="padding:16px 4px 0;font-size:14px;color:#5b6582">Jérôme</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html };
}

module.exports = { missionEmail };
