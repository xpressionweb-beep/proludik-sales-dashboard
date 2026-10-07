// Les 15 missions de départ de la boîte "Le Boost".
// Utilisées seulement à la création de data/boost.json; ensuite, on ajoute
// ou modifie les missions depuis la page boost.html.
module.exports = [
  { id: 'd01', num: 1, l1: 'RÉVEILLE', l2: 'LES DORMEURS', icone: 'dormeurs', desc: "Réactive 3 anciens clients qui n'ont pas acheté chez Proludik depuis 2024." },
  { id: 'd02', num: 2, l1: 'MUNICIPALITÉS', l2: '', icone: 'ville', desc: "Identifie et contacte 3 nouvelles municipalités avec lesquelles nous faisons peu ou pas d'affaires." },
  { id: 'd03', num: 3, l1: 'CLONE TON', l2: 'MEILLEUR CLIENT', icone: 'loupe', desc: 'Choisis 1 excellent client, trouve 3 organisations similaires et contacte-les.' },
  { id: 'd04', num: 4, l1: 'LE TÉLÉPHONE', l2: 'EXISTE ENCORE', icone: 'telephone', desc: "Fais 3 appels de prospection à des entreprises avec lesquelles tu n'as jamais parlé. Pas de courriel comme premier contact." },
  { id: 'd05', num: 5, l1: 'RETOURNE VOIR', l2: 'LES PERDUS', icone: 'perdus', desc: 'Reprends 3 soumissions perdues des 12 derniers mois et tente de rouvrir la porte.' },
  { id: 'd06', num: 6, l1: 'CHANGE', l2: 'DE DIVISION', icone: 'division', desc: 'Trouve 3 clients actuels qui achètent dans une seule division et présente-leur une autre solution Proludik.' },
  { id: 'd07', num: 7, l1: 'MISSION', l2: '5 000 $', icone: 'argent', desc: 'Identifie 3 prospects qui pourraient chacun représenter un projet de 5 000 $ ou plus. Fais une première approche.' },
  { id: 'd08', num: 8, l1: 'DONNE-MOI', l2: '2 NOMS', icone: 'references', desc: "Contacte 1 bon client et demande-lui des références. Continue tes démarches tant que tu n'as pas reçu 2 références." },
  { id: 'd09', num: 9, l1: 'NOUVEAU', l2: 'TERRITOIRE', icone: 'cible', desc: "Choisis un secteur d'activité que tu sollicites rarement, trouve 3 prospects et contacte-les." },
  { id: 'd10', num: 10, l1: 'LE CLIENT', l2: '2025', icone: 'calendrier', desc: "Trouve 5 clients ayant acheté l'an dernier, mais qui n'ont encore rien réservé/acheté cette année. Contacte-les." },
  { id: 'd11', num: 11, l1: 'PRENDS UN', l2: 'RENDEZ-VOUS', icone: 'calendrier', desc: 'Ton objectif cette semaine : obtenir 2 nouveaux rendez-vous, Teams ou en personne, avec des prospects.' },
  { id: 'd12', num: 12, l1: 'MARKETING', l2: 'TRAVAILLE POUR TOI', icone: 'megaphone', desc: 'Choisis un marché ou produit et travaille avec Marketing pour créer une mini-action de prospection. Tu dois ensuite contacter 5 prospects avec cet outil.' },
  { id: 'd13', num: 13, l1: 'LA CARTE', l2: 'DG', icone: 'etoile', desc: "Identifie un prospect important que tu as de la difficulté à approcher. La direction doit t'aider à trouver une façon d'ouvrir la porte." },
  { id: 'd14', num: 14, l1: 'FAIS-MOI', l2: 'RÊVER', icone: 'idee', desc: "Trouve 1 organisation avec laquelle tu aimerais vraiment voir Proludik travailler. L'équipe t'aide à identifier le décideur et construire ton approche." },
  { id: 'd15', num: 15, l1: 'LE PRODUIT', l2: 'VEDETTE', icone: 'chateau', desc: 'Choisis un produit ou service Proludik que tu veux pousser cette semaine. Identifie 5 clients/prospects à qui il correspond et contacte-les.' },
];
