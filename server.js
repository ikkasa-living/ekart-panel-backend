import dotenv from "dotenv";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";

import orderRoutes from "./routes/orderRoutes.js";
import csvRoutes from "./routes/csvRoutes.js";
import shopifyRoutes from "./routes/shopifyRoutes.js";
import authRoutes from "./routes/auth.js";
import ekartRoutes from './routes/ekartRoutes.js';


dotenv.config();

const app = express();

app.use(cors({
  origin: [process.env.FRONTEND_ORIGIN],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running...");
});

app.use("/api/orders", orderRoutes);
app.use("/api/csv", csvRoutes);
app.use("/api/shopify", shopifyRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/ekart", ekartRoutes);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

// Start server (local dev)
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Server running locally on port ${PORT}`);
  });
}

export default app;
