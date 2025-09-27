import dotenv from "dotenv";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";

import orderRoutes from "./routes/orderRoutes.js";
import csvRoutes from "./routes/csvRoutes.js";
import shopifyRoutes from "./routes/shopifyRoutes.js";
import authRoutes from "./routes/auth.js";
import ekartRoutes from "./routes/ekartRoutes.js";

dotenv.config();

const app = express();

// CORS setup
app.use(cors({
  origin: [process.env.FRONTEND_ORIGIN || "*"], // fallback for safety
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));

app.use(express.json());

// Default route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// API routes
app.use("/api/orders", orderRoutes);
app.use("/api/csv", csvRoutes);
app.use("/api/shopify", shopifyRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/ekart", ekartRoutes);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// Always start the server (works for both dev + production)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;
