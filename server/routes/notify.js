const express = require('express');
const router = express.Router();

const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN; // aw4eq8sucaf9fgp9fyqtpphpojfi3m
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;   // uvhjffnfwk2dm3d1c5fvhrfw5and3j

// Liste des destinataires — le "device" doit matcher EXACTEMENT
// le nom affiché sur pushover.net → "Your Devices"
const RECIPIENTS = {
  jerome: { label: "Jérôme (DG)", device: "iphone-je" },
  // dan: { label: "Dan (Entrepôt)", device: "NOM_A_CONFIRMER" },
};

// GET /api/notify/recipients
router.get('/recipients', (req, res) => {
  const list = Object.entries(RECIPIENTS).map(([id, r]) => ({ id, label: r.label }));
  res.json(list);
});

// POST /api/notify
router.post('/', async (req, res) => {
  const { recipient, message } = req.body;
  const target = RECIPIENTS[recipient];

  if (!target) {
    return res.status(400).json({ error: 'Destinataire invalide' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message vide' });
  }

  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: PUSHOVER_APP_TOKEN,
        user: PUSHOVER_USER_KEY,
        device: target.device,
        message: message,
        title: 'Proludik - Réception',
      }),
    });
    const data = await response.json();

    if (data.status === 1) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: (data.errors || []).join(', ') || 'Erreur Pushover' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
