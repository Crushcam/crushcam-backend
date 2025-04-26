require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

const serviceAccount = require('/etc/secrets/firebase-service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.post(
  '/create-verification-session',
  express.json(),
  async (req, res) => {
    try {
const session = await stripe.identity.verificationSessions.create({
  type: 'document',
  metadata: { user_id: req.body.userId || 'demo_user' },
  return_url: 'crushcam://verification-success', // <--- Ajout important ici
});

      console.log('✅ Lien Stripe généré :', session.url);
      return res.json({ url: session.url });
    } catch (err) {
      console.error('❌ Erreur création session :', err);
      return res.status(500).json({ error: 'Erreur création session' });
    }
  }
);

app.get('/', (req, res) => {
  res.send('🤖 CrushCam backend is up!');
});

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('⚠️ Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log('🔔 Reçu event type →', event.type);

    if (event.type === 'identity.verification_session.verified') {
      const session = event.data.object;
      const userId = session.metadata.user_id;
      console.log(`✅ Identity vérifiée pour user_id=${userId}`);

      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
          console.log(`❌ Utilisateur ${userId} introuvable dans Firestore`);
          return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        const data = userDoc.data();
        const firestoreNom = (data.nom || '').toLowerCase().trim();
        const firestorePrenom = (data.prenom || '').toLowerCase().trim();
        const firestoreNaissance = (data.date_naissance || '').replace(' ans', '').trim();

        const fullSession = await stripe.identity.verificationSessions.retrieve(session.id, {
          expand: ['last_verification_report.document']
        });

        const docInfo = fullSession.last_verification_report.document;
        const docNom = (docInfo.name?.last_name || '').toLowerCase().trim();
        const docPrenom = (docInfo.name?.first_name || '').toLowerCase().trim();
        const dob = docInfo.dob;
        const now = new Date();
        const birthDate = new Date(dob.year, dob.month - 1, dob.day);
        let age = now.getFullYear() - birthDate.getFullYear();
        const m = now.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) {
          age--;
        }

        console.log('📄 Comparaison :', { firestoreNom, firestorePrenom, firestoreNaissance, docNom, docPrenom, age });

        const updates = {};
        let corrected = false;

        if (firestoreNom !== docNom) {
          updates.nom = docNom;
          corrected = true;
        }
        if (firestorePrenom !== docPrenom) {
          updates.prenom = docPrenom;
          corrected = true;
        }
        if (firestoreNaissance !== age.toString()) {
          updates.date_naissance = `${age} ans`;
          corrected = true;
        }

        updates.isVerified = true; // Toujours ajouter isVerified = true

        await userRef.update(updates);

        if (corrected) {
          console.log('✅ Infos corrigées et utilisateur vérifié');
        } else {
          console.log('✅ Infos inchangées, utilisateur vérifié');
        }

      } catch (error) {
        console.error('❌ Erreur traitement Firestore :', error);
        return res.status(500).json({ error: 'Erreur serveur Firebase' });
      }
    }

    res.json({ received: true });
  }
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serveur lancé sur http://0.0.0.0:${PORT}`);
});
