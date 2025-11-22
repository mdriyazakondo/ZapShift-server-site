require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_KEY);

const app = express();
const port = process.env.PORT || 5000;

const crypto = require("crypto");

function generateTrackingId() {
  const prefix = "PRCL"; // your brand prefix
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

// middleware
app.use(cors());
app.use(express.json());

// mogodb connect
const uri = process.env.DB_URL;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

client
  .connect()
  .then(() => {
    app.listen(port, () => {
      console.log(`server is running port ${port}`);
      console.log(`Zap shit Server Connected with DB`);
    });
  })
  .catch((err) => {
    console.log(err);
  });

const db = client.db("zap_shit_db");
const parcelCollection = db.collection("parcels");
const paymentCollection = db.collection("payments");

//======== parcel api ================//
app.get("/parcels", async (req, res) => {
  try {
    const query = {};
    const { email } = req.query;

    if (email) {
      query.senderEmail = email;
    }
    const options = { sort: { createAt: -1 } };
    const result = await parcelCollection.find(query, options).toArray();
    res
      .status(200)
      .send({ message: "parcel data successfully connect", result });
  } catch (error) {
    res.status(500).send({ message: "Intarnal server error" });
  }
});

app.get("/parcels/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await parcelCollection.findOne(query);
    res
      .status(200)
      .send({ message: "parcel single data successfully connect", result });
  } catch (error) {
    res.status(500).send({ message: "Intarnal server error" });
  }
});

app.post("/parcels", async (req, res) => {
  try {
    const newParcels = req.body;
    newParcels.createAt = new Date();
    const result = await parcelCollection.insertOne(newParcels);
    res.status(201).send({ message: "parcel post success", result });
  } catch (error) {
    res.status(500).send({ message: "Intarnal server error" });
  }
});

app.delete("/parcels/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await parcelCollection.deleteOne(query);
    res.status(200).send({ message: "parcel deleted successfully ", result });
  } catch (error) {
    res.status(500).send({ message: "Intarnal server error" });
  }
});

//===== payment releted api ============//
// new api

app.post("/payment-checkout-session", async (req, res) => {
  const paymentInfo = req.body;
  const amout = parseInt(paymentInfo.cost) * 100;
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: "USD",
          unit_amount: amout,
          product_data: {
            name: `Please pay for ${paymentInfo.parcelName}`,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: paymentInfo.senderEmail,
    metadata: {
      parcelId: paymentInfo.parcelId,
      parcelName: paymentInfo.parcelName,
    },
    mode: "payment",
    success_url: `${process.env.SITE_DOMIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMIN}/dashboard/payment-cancelled`,
  });
  // console.log(session);
  res.send({ url: session.url });
});

// old api
app.post("/stripe-checkout-sessions", async (req, res) => {
  const paymentInfo = req.body;
  const amount = parseInt(paymentInfo.cost) * 100;
  const session = stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: "USD",
          unit_amount: amount,
          product_data: {
            name: paymentInfo.parcelName,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: paymentInfo.senderEmail,
    mode: "payment",
    metadata: {
      parcelId: paymentInfo.parcelId,
    },
    success_url: `${process.env.SITE_DOMIN}/dashboard/payment-success`,
    cancel_url: `${process.env.SITE_DOMIN}/dashboard/payment-cancelled`,
  });
  console.log(session);
  res.send({ url: session.url });
});

app.patch("/payment-success", async (req, res) => {
  const sessionId = req.query.session_id;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const transictionId = session.payment_intent;

  const exitPayment = await paymentCollection.findOne({ transictionId });
  if (exitPayment) {
    return res.send({
      message: "already exiting payment",
      transictionId,
      trackingId: exitPayment.trackingId,
    });
  }

  const trackingId = generateTrackingId();
  if (session.payment_status === "paid") {
    const id = session.metadata.parcelId;
    const query = { _id: new ObjectId(id) };
    const update = {
      $set: {
        payment_status: "paid",
        trackingId: trackingId,
      },
    };
    const result = await parcelCollection.updateOne(query, update);
    const payment = {
      amount: session.amount_total,
      currency: session.currency,
      customerEmail: session.customer_email,
      parcelId: session.metadata.parcelId,
      parcelName: session.metadata.parcelName,
      transictionId: session.payment_intent,
      paymentStatus: session.payment_status,
      paymentA: new Date(),
      trackingId: trackingId,
    };
    if (session.payment_status === "paid") {
      const resultPayment = await paymentCollection.insertOne(payment);
      return res.send({
        success: true,
        modifyParcel: result,
        trackingId: trackingId,
        transictionId: session.payment_intent,
        paymentInfo: resultPayment,
      });
    }
  }
  return res.send({ success: false });
});

// payment releted history
app.get("/payments", async (req, res) => {
  const email = req.query.email;
  const query = {};
  if (email) {
    query.customerEmail = email;
  }
  const result = await paymentCollection.find(query).toArray();
  res.send({ message: "payments successfully", result });
});

app.get("/", (req, res) => {
  res.send("server is runnig port");
});
