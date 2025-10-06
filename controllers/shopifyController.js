import axios from "axios";
import Order from "../models/Order.js";
import dotenv from "dotenv";

dotenv.config();

const SHOP = process.env.SHOPIFY_STORE_URL;
const API_VER = process.env.SHOPIFY_API_VERSION;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

export const syncOrders = async (req, res) => {
  try {
    let allOrders = [];
    let url = `https://${SHOP}/admin/api/${API_VER}/orders.json?status=any&limit=250&order=created_at%20desc`;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await axios.get(url, {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      });

      allOrders = [...allOrders, ...response.data.orders];

      const linkHeader = response.headers["link"];
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<([^>]+)>; rel="next"/);
        if (match && match[1]) {
          url = match[1];
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    }

    const savedOrders = [];

    for (let sOrder of allOrders) {
      // Check if already exists to **skip updating**
      const existing = await Order.findOne({ shopifyId: sOrder.id });
      if (existing) continue;

      const customerName = 
        [sOrder.customer?.first_name, sOrder.customer?.last_name]
          .filter(Boolean)
          .join(" ")
          || sOrder.shipping_address?.name
          || sOrder.billing_address?.name
          || "Unknown Customer";

      let paymentMethod = sOrder.gateway ? sOrder.gateway.toUpperCase() : "";
      if (!paymentMethod || paymentMethod === "UNKNOWN") {
        paymentMethod = sOrder.financial_status === "pending" ? "COD" : "PREPAID";
      }

      const orderData = {
        shopifyId: sOrder.id,
        orderId: sOrder.order_number.toString(),
        orderDate: new Date(sOrder.created_at),
        customerName: customerName || null,
        customerPhone: sOrder.customer?.phone || sOrder.shipping_address?.phone || null,
        customerEmail: sOrder.customer?.email || sOrder.email || null,
        customerAddress: [
          sOrder.shipping_address?.address1,
          sOrder.shipping_address?.address2,
          sOrder.shipping_address?.city,
          sOrder.shipping_address?.province,
          sOrder.shipping_address?.country,
        ].filter(Boolean).join(", "),
        products: sOrder.line_items.map((item) => ({
          productName: item.name,
          quantity: item.quantity,
        })),
        amount: parseFloat(sOrder.total_price) || 0,
        paymentMode: paymentMethod,
        vendorName: sOrder.vendor || "",
        pickupAddress: sOrder.shipping_address?.address1 || "",
        status: "",
      };

      const saved = await Order.create(orderData); // Insert only new order

      savedOrders.push(saved);
    }

    res.json({
      success: true,
      count: savedOrders.length,
      data: savedOrders,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Other CRUD remains unchanged

export const createOrder = async (req, res) => {
  try {
    if (req.body.orderDate) {
      req.body.orderDate = new Date(req.body.orderDate);
    }
    const newOrder = await Order.create(req.body);
    res.json({ success: true, data: newOrder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ orderDate: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateOrder = async (req, res) => {
  try {
    if (req.body.orderDate) {
      req.body.orderDate = new Date(req.body.orderDate);
    }
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedOrder) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    res.json({ success: true, data: updatedOrder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    res.json({ success: true, message: "Order deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
