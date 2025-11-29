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

// varify firebase token

const admin = require("firebase-admin");

const serviceAccount = require("./firebase-token-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
const varifyFirebaseToken = async (req, res, next) => {
  const varifyToken = req.headers.authorization;
  if (!varifyToken) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = varifyToken.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const varifyAdmin = async (req, res, next) => {
  const email = req.decoded_email;
  const query = { email };
  const user = await userCollection.findOne(query);
  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "forbidden accec admin" });
  }
  next();
};

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
const userCollection = db.collection("users");
const parcelCollection = db.collection("parcels");
const paymentCollection = db.collection("payments");
const riderCollection = db.collection("riders");
const trackingCollection = db.collection("trackings");

//====== tracking function =======//
const logTracking = async (trackingId, status) => {
  const log = {
    trackingId,
    status,
    details: status.split("-").join(" "),
    createAt: new Date(),
  };
  const result = await trackingCollection.insertOne(log);
  return result;
};

//====== Users Releted Apis
app.get("/users", varifyFirebaseToken, async (req, res) => {
  const searchUser = req.query.search;
  const query = {};

  if (searchUser) {
    query.$or = [
      { displayName: { $regex: searchUser, $options: "i" } },
      { email: { $regex: searchUser, $options: "i" } },
    ];
  }
  const result = await userCollection
    .find(query)
    .sort({ createAt: -1 })
    .limit(10)
    .toArray();
  res.send({ message: "users successfully get", result });
});

app.get("/users/:id", varifyFirebaseToken, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await userCollection.findOne(query);
  res.send({ message: "single user successfully get", result });
});

app.get("/users/:email/role", async (req, res) => {
  const email = req.params.email;
  const query = { email };
  const user = await userCollection.findOne(query);
  res.send({ role: user?.role || "user" });
});

app.post("/users", async (req, res) => {
  const newUser = req.body;
  newUser.role = "user";
  newUser.createAt = new Date();
  const email = newUser.email;
  const userExit = await userCollection.findOne({ email });
  if (userExit) {
    return res.status(409).send({ message: "User already exists" });
  }
  const result = await userCollection.insertOne(newUser);
  res.send({ message: "user create successfully", result });
});

app.patch(
  "/users/:id/role",
  varifyFirebaseToken,
  varifyAdmin,
  async (req, res) => {
    const id = req.params.id;
    const roleInfo = req.body;
    const query = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        role: roleInfo.role,
      },
    };
    const result = await userCollection.updateOne(query, updateDoc);
    res.status(200).send({ message: "user role update successfully", result });
  }
);

app.delete("/users/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await userCollection.deleteOne(query);
  res.send({ message: "single user successfully get", result });
});

//======== parcel api ================//
app.get("/parcels", async (req, res) => {
  try {
    const query = {};
    const { email, deliveryStatus } = req.query;

    if (email) {
      query.senderEmail = email;
    }
    if (deliveryStatus) {
      query.deliveryStatus = deliveryStatus;
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

app.get("/parcels/rider", async (req, res) => {
  const { riderEmail, deliveryStatus } = req.query;
  const query = {};
  if (riderEmail) {
    query.riderEmail = riderEmail;
  }
  if (deliveryStatus !== "parcel_delivered") {
    query.deliveryStatus = {
      $nin: ["parcel_delivered"],
    };
  } else {
    query.deliveryStatus = deliveryStatus;
  }
  const result = await parcelCollection.find(query).toArray();
  res.send({ message: "parcels rider successfully", result });
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
    const trackingId = generateTrackingId();
    newParcels.trackingId = trackingId;
    logTracking(trackingId, "parcel_created");
    const result = await parcelCollection.insertOne(newParcels);
    res.status(201).send({ message: "parcel post success", result });
  } catch (error) {
    res.status(500).send({ message: "Intarnal server error" });
  }
});

app.patch("/parcels/:id", async (req, res) => {
  const { riderId, riderNmae, riderEmail, trackingId } = req.body;
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      deliveryStatus: "driver_assigned",
      riderId: riderId,
      riderNmae: riderNmae,
      riderEmail: riderEmail,
    },
  };
  const result = await parcelCollection.updateOne(query, updateDoc);
  const riderQuery = { _id: new ObjectId(riderId) };
  const riderUpdateDoc = {
    $set: {
      workStatus: "in_delivery",
    },
  };
  const riderResult = await riderCollection.updateOne(
    riderQuery,
    riderUpdateDoc
  );
  //log traking
  logTracking(trackingId, "driver_assigned");
  res.send(riderResult);
});

app.patch("/parcels/:id/status", async (req, res) => {
  const { deliveryStatus, riderId, trackingId } = req.body;
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      deliveryStatus: deliveryStatus,
    },
  };
  const result = await parcelCollection.updateOne(query, updateDoc);

  if (deliveryStatus === "parcel_delivered") {
    const riderQuery = { _id: new ObjectId(riderId) };
    const riderUpdateDoc = {
      $set: {
        workStatus: "available",
      },
    };
    const riderResult = await riderCollection.updateOne(
      riderQuery,
      riderUpdateDoc
    );
  }
  logTracking(trackingId, deliveryStatus);
  res.send({ message: "deliveryStatus update success", result });
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
      trackingId: paymentInfo.trackingId,
    },
    mode: "payment",
    success_url: `${process.env.SITE_DOMIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMIN}/dashboard/payment-cancelled`,
  });
  // console.log(session);
  res.send({ url: session.url });
});

// old api
// app.post("/stripe-checkout-sessions", async (req, res) => {
//   const paymentInfo = req.body;
//   const amount = parseInt(paymentInfo.cost) * 100;
//   const session = stripe.checkout.sessions.create({
//     line_items: [
//       {
//         price_data: {
//           currency: "USD",
//           unit_amount: amount,
//           product_data: {
//             name: paymentInfo.parcelName,
//           },
//         },
//         quantity: 1,
//       },
//     ],
//     customer_email: paymentInfo.senderEmail,
//     mode: "payment",
//     metadata: {
//       parcelId: paymentInfo.parcelId,
//     },
//     success_url: `${process.env.SITE_DOMIN}/dashboard/payment-success`,
//     cancel_url: `${process.env.SITE_DOMIN}/dashboard/payment-cancelled`,
//   });
//   res.send({ url: session.url });
// });

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

  const trackingId = session.metadata.trackingId;
  if (session.payment_status === "paid") {
    const id = session.metadata.parcelId;
    const query = { _id: new ObjectId(id) };
    const update = {
      $set: {
        payment_status: "paid",
        deliveryStatus: "pending-pickup",
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
      logTracking(trackingId, "parcel_paid");
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

//======= payment releted history   ==========//
app.get("/payments", varifyFirebaseToken, async (req, res) => {
  const email = req.query.email;
  const query = {};
  if (email) {
    query.customerEmail = email;
    if (email !== req.decoded_email) {
      return res.status(403).send({ message: "request forbidden access" });
    }
  }
  const result = await paymentCollection
    .find(query)
    .sort({ paymentA: -1 })
    .toArray();
  res.send({ message: "payments successfully", result });
});

//=====Riders api =======//
app.get("/riders", async (req, res) => {
  const { status, district, workStatus } = req.query;
  const query = {};
  if (status) {
    query.status = req.query.status;
  }
  if (district) {
    query.district = district;
  }
  if (workStatus) {
    query.workStatus = workStatus;
  }
  const result = await riderCollection.find(query).toArray();
  res.send({ message: "all riders show", result });
});

app.post("/riders", async (req, res) => {
  const newRiders = req.body;
  newRiders.status = "pending";
  newRiders.createAt = new Date();
  const result = await riderCollection.insertOne(newRiders);
  res.send({ message: "new riders created", result });
});

app.patch("/riders/:id", varifyFirebaseToken, varifyAdmin, async (req, res) => {
  const status = req.body.status;
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      status: status,
      workStatus: "available",
    },
  };
  const result = await riderCollection.updateOne(query, updateDoc);

  if (status === "approved") {
    const email = req.body.email;
    const userQueary = { email };
    const userUpdate = {
      $set: {
        role: "rider",
      },
    };
    const userResult = await userCollection.updateOne(userQueary, userUpdate);
    res.send({ result, userResult });
  }
  res.send({ message: "status update successfully", result });
});

app.delete("/riders/:id", varifyFirebaseToken, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await riderCollection.deleteOne(query);
    res.status(200).send({ message: "riders deleted successfully ", result });
  } catch (error) {
    res.status(500).send({ message: "Intarnal server error" });
  }
});

//===== traking api =====//
app.get("/trackings/:trackingId/logs", async (req, res) => {
  const trackingId = req.params.trackingId;
  const query = { trackingId };
  const result = await trackingCollection.find(query).toArray();
  res.send({ message: "tracking details success", result });
});

app.get("/", (req, res) => {
  res.send("server is runnig port");
});
