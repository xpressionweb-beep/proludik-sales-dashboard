const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');

const PUSHOVER_APP_TOKEN = process.env.PUSHOVER_APP_TOKEN; // aw4eq8sucaf9fgp9fyqtpphpojfi3m
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;   // uvhjffnfwk2dm3d1c5fvhrfw5and3j

// Liste des destinataires — le "device" doit matcher EXACTEMENT
// le nom affiché sur pushover.net → "Your Devices"
const RECIPIENTS = {
  jerome: { label: "Jérôme", device: "iphone-je" },
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

  const id = crypto.randomBytes(8).toString('hex');
  const confirmUrl = `${req.protocol}://${req.get('host')}/confirm.html?id=${id}`;

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
        url: confirmUrl,
        url_title: 'Confirmer la réception ✓',
      }),
    });
    const data = await response.json();

    if (data.status === 1) {
      db.createNotif({
        id,
        recipient,
        recipientLabel: target.label,
        message,
        sentAt: new Date().toISOString(),
        ackAt: null,
      });
      res.json({ success: true, id });
    } else {
      res.status(500).json({ error: (data.errors || []).join(', ') || 'Erreur Pushover' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notify/:id/status — pour que l'écran d'envoi sache si le message a été vu
router.get('/:id/status', (req, res) => {
  const notif = db.getNotif(req.params.id);
  if (!notif) return res.status(404).json({ error: 'Introuvable' });
  res.json({
    id: notif.id,
    message: notif.message,
    recipientLabel: notif.recipientLabel,
    sentAt: notif.sentAt,
    ackAt: notif.ackAt,
    seen: !!notif.ackAt,
  });
});

// POST /api/notify/:id/ack — appelé par confirm.html quand l'employé clique le crochet
router.post('/:id/ack', (req, res) => {
  const notif = db.ackNotif(req.params.id);
  if (!notif) return res.status(404).json({ error: 'Introuvable' });
  res.json({ success: true, ackAt: notif.ackAt });
});

module.exports = router;
