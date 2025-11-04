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

    console.log("Fetching orders from Shopify...");

    // 🌀 Fetch all orders with pagination
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
        url = match && match[1] ? match[1] : null;
        hasNextPage = !!url;
      } else {
        hasNextPage = false;
      }
    }

    console.log(`Fetched ${allOrders.length} orders from Shopify.`);

    const savedOrders = [];
    const productCache = new Map(); // ⚡ Cache productId → imageUrl

    // 🧠 Process each order
    for (let sOrder of allOrders) {
      const existing = await Order.findOne({ shopifyId: sOrder.id });
      if (existing) continue; // Skip already saved orders

      const customerName =
        [sOrder.customer?.first_name, sOrder.customer?.last_name]
          .filter(Boolean)
          .join(" ") ||
        sOrder.shipping_address?.name ||
        sOrder.billing_address?.name ||
        "Unknown Customer";

      let paymentMethod = sOrder.gateway ? sOrder.gateway.toUpperCase() : "";
      if (!paymentMethod || paymentMethod === "UNKNOWN") {
        paymentMethod =
          sOrder.financial_status === "pending" ? "COD" : "PREPAID";
      }

      // 🖼️ Fetch product images efficiently
      const productsWithImages = await Promise.all(
        sOrder.line_items.map(async (item) => {
          let imageUrl = "";

          if (item.product_id) {
            // ✅ Check cache first
            if (productCache.has(item.product_id)) {
              imageUrl = productCache.get(item.product_id);
            } else {
              try {
                const productRes = await axios.get(
                  `https://${SHOP}/admin/api/${API_VER}/products/${item.product_id}.json`,
                  { headers: { "X-Shopify-Access-Token": TOKEN } }
                );
                imageUrl = productRes.data.product?.image?.src || "";
                productCache.set(item.product_id, imageUrl); // Store in cache
              } catch (err) {
                console.warn(
                  `⚠️ Failed to fetch image for product ${item.name} (ID: ${item.product_id})`
                );
              }
            }
          }

          return {
            productName: item.name,
            quantity: item.quantity,
            imageUrl: imageUrl,
          };
        })
      );

      // 🧾 Prepare order data with current timestamp for new orders
      const orderData = {
        shopifyId: sOrder.id,
        orderId: sOrder.order_number?.toString() || "",
        orderDate: new Date(sOrder.created_at),
        customerName,
        customerPhone:
          sOrder.customer?.phone || sOrder.shipping_address?.phone || null,
        customerEmail: sOrder.customer?.email || sOrder.email || null,
        customerAddress: [
          sOrder.shipping_address?.address1,
          sOrder.shipping_address?.address2,
          sOrder.shipping_address?.city,
          sOrder.shipping_address?.province,
          sOrder.shipping_address?.country,
        ]
          .filter(Boolean)
          .join(", "),
        products: productsWithImages,
        amount: parseFloat(sOrder.total_price) || 0,
        paymentMode: paymentMethod,
        vendorName: sOrder.vendor || "",
        pickupAddress: sOrder.shipping_address?.address1 || "",
        status: "",
        // Add explicit timestamps to ensure proper sorting
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // 💾 Save new order to MongoDB
      const saved = await Order.create(orderData);
      savedOrders.push(saved);
    }

    console.log(`✅ Synced ${savedOrders.length} new orders.`);

    res.json({
      success: true,
      count: savedOrders.length,
      data: savedOrders,
    });
  } catch (err) {
    console.error("❌ Error syncing orders:", err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createOrder = async (req, res) => {
  try {
    if (req.body.orderDate) {
      req.body.orderDate = new Date(req.body.orderDate);
    }
    
    // Ensure new orders have current timestamps
    req.body.createdAt = new Date();
    req.body.updatedAt = new Date();
    
    const newOrder = await Order.create(req.body);
    res.json({ success: true, data: newOrder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getOrders = async (req, res) => {
  try {
    // Sort by updatedAt descending first, then by createdAt descending
    const orders = await Order.find().sort({ 
      updatedAt: -1, 
      createdAt: -1,
      _id: -1 // fallback sort by MongoDB ObjectId (which contains timestamp)
    });
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
    
    // Always update the updatedAt timestamp
    req.body.updatedAt = new Date();

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
