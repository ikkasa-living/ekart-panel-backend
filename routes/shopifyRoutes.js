import express from "express";
import {
  syncOrders,
  createOrder,
  getOrders,
  getOrderById,
  updateOrder,
  deleteOrder
} from "../controllers/shopifyController.js";

const router = express.Router();

// Shopify Sync
router.get("/sync-orders", syncOrders);

// Get all orders
router.get("/orders", getOrders);

// CRUD
router.post("/orders", createOrder);
router.get("/orders/:id", getOrderById);
router.put("/orders/:id", updateOrder);
router.delete("/orders/:id", deleteOrder);

export default router;