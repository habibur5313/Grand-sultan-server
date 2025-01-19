const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 5000;
const app = express();

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8yejb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const document = client.db("BuildCareDB");
    // collections
    const ApartmentsCollection = document.collection("apartments");
    const userCollection = document.collection("users");
    const agreementCollection = document.collection("agreements");
    const memberAgreementCollection = document.collection("memberAgreement");
    const announcementCollection = document.collection("announcements");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10d",
      });
      res.send({ token });
    });

    // middleware
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // users related apis
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    //  apartments related apis
    app.get("/apartments", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const skip = (page - 1) * limit;      
      const result = await ApartmentsCollection.find().skip(skip)
      .limit(limit).toArray();
      res.send(result);
    });

    app.get("/apartmentsCount", async (req, res) => {
      const total = await ApartmentsCollection.estimatedDocumentCount();
      res.send({ total });
      // console.log(total);
    });

    app.get("/search", async (req, res) => {
      const search = parseInt(req.query.search);
      let cursor = {
        rent: {
          $lte: search,
        },
      };
      const result = await ApartmentsCollection.find(cursor).toArray();
      res.send(result);
    });

    // agreements related apis
    app.get("/agreements", verifyToken, verifyAdmin, async (req, res) => {
      const result = await agreementCollection.find().toArray();
      res.send(result);
    });

    app.get(
      "/agreements/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const result = await agreementCollection.findOne(query);
        res.send(result);
      }
    );

    app.post("/agreements/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const isExist = await agreementCollection.findOne(query);
      if (isExist) {
        return res.send({
          message: "One user one agreement",
          insertedId: null,
        });
      }
      const agreement = req.body;
      const result = await agreementCollection.insertOne(agreement);
      const insertAgreement = await memberAgreementCollection.insertOne(
        agreement
      );
      res.send(result);
    });

    app.patch(
      "/agreementsRequest/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: "checked",
          },
        };
        const agreementUpdate = await memberAgreementCollection.updateOne(
          filter,
          updatedDoc
        );
        const button = req.query.button;
        const email = req.query.email;
        const query = { email: email };
        if (button === "accept") {
          const update = {
            $set: {
              role: "member",
            },
          };
          const result = await userCollection.updateOne(query, update);
          const requestDelete = await agreementCollection.deleteOne(query);
          res.send(result);
        } else {
          const result = await agreementCollection.deleteOne(query);
          res.send(result);
        }
      }
    );

    // announcements related apis
    app.get("/makeAnnouncements", verifyToken, async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });
    app.post(
      "/makeAnnouncements",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const announcement = req.body;
        const result = await announcementCollection.insertOne(announcement);
        res.send(result);
      }
    );

    // members apis
    app.get("/members", verifyToken, verifyAdmin, async (req, res) => {
      const query = { role: "member" };
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    app.patch("/members/:id",verifyToken,verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: {
          role: "",
        },
      };
      const result = await userCollection.updateOne(query, update);
      res.send(result);
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //     await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("hello from home");
});

app.listen(port, () => {
  console.log("server is running");
});
