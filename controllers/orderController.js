import Order from "../models/Order.js";
import { calcVolumetricWeight } from "../utils/calcVolWeight.js";

export const createOrder = async (req, res, next) => {
  try {
    if (req.body.length && req.body.breadth && req.body.height) {
      req.body.volumetricWeight = calcVolumetricWeight(
        req.body.length, req.body.breadth, req.body.height
      );
    }
    if (req.body.orderDate) {
      req.body.orderDate = new Date(req.body.orderDate);
    }
    const newOrder = await Order.create(req.body);
    res.status(201).json(newOrder);
  } catch (err) {
    next(err);
  }
};

// Pagination with page and limit query params
export const getOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 20);
    const orders = await Order.find()
      .sort({ updatedAt: -1 }) // Sort latest updated first
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Order.countDocuments();
    res.json({ total, page, limit, data: orders });
  } catch (err) {
    next(err);
  }
};

export const updateOrder = async (req, res, next) => {
  try {
    if (req.body.updatedAt) delete req.body.updatedAt;

    // ✅ Only remove productImage if client explicitly sends an empty one
    if ("productImage" in req.body && !req.body.productImage) {
      delete req.body.productImage;
    }

    if (req.body.length && req.body.breadth && req.body.height) {
      req.body.volumetricWeight = calcVolumetricWeight(
        req.body.length,
        req.body.breadth,
        req.body.height
      );
    }

    if (req.body.orderDate) {
      req.body.orderDate = new Date(req.body.orderDate);
    }

    req.body.updatedAt = new Date();

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );

    if (!updatedOrder)
      return res.status(404).json({ error: "Order not found" });

    res.json({ data: updatedOrder });
  } catch (err) {
    next(err);
  }
};


export const deleteOrder = async (req, res, next) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).json({ error: "Order not found" });
    res.json({ message: "Order deleted" });
  } catch (err) {
    next(err);
  }
};
