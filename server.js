require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json'); // Mets ton vrai fichier ici

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
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
        const nom = (data.nom || '').toLowerCase().trim();
        const prenom = (data.prenom || '').toLowerCase().trim();
        const ageTexte = (data.date_naissance || '').replace(' ans', '').trim();

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

        console.log('📄 Comparaison :', { nom, prenom, ageTexte, docNom, docPrenom, age });

        if (nom === docNom && prenom === docPrenom && ageTexte === age.toString()) {
          await userRef.update({ isVerified: true });
          console.log('✅ Utilisateur confirmé et vérifié');
        } else {
          console.log('❌ Données non conformes — suppression');
          await userRef.delete();
          await admin.auth().deleteUser(userId);
          return res.status(403).json({
            error: 'Données non conformes — compte supprimé'
          });
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
