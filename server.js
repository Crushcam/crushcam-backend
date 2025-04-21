// Charge les variables d'environnement depuis .env
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Création de la session de vérification Stripe
app.post("/create-verification-session", async (req, res) => {
  try {
    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { user_id: req.body.userId || "demo_user" },
    });
    console.log("✅ Lien Stripe :", session.url);
    res.json({ url: session.url });
  } catch (error) {
    console.error("❌ Erreur session :", error);
    res.status(500).json({ error: "Erreur création session" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serveur lancé sur http://0.0.0.0:${PORT}`);
});
