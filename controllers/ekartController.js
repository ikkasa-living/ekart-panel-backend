import axios from "axios";
import Order from "../models/Order.js";
import { getAuthToken } from "../ekartService.js";

export const createEkartReturn = async (req, res) => {
  try {
    const requiredFields = [
      "orderId",
      "customerName", 
      "customerPhone",
      "customerAddress",
      "city",
      "state",
      "pincode",
      "products",
      "amount",
      "hsn",
      "invoiceId",
    ];

    for (const field of requiredFields) {
      if (
        !req.body[field] ||
        (field === "products" &&
          (!Array.isArray(req.body.products) || req.body.products.length === 0))
      ) {
        return res.status(400).json({
          success: false,
          message: `Missing or invalid field: ${field}`,
        });
      }
    }

    const {
      orderId,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      city,
      state,
      pincode,
      products,
      deadWeight,
      length,
      breadth,
      height,
      volumetricWeight,
      amount,
      paymentMode,
      pickupAddress,
      pickupCity,
      pickupState,
      pickupPincode,
      gstin,
      hsn,
      invoiceId,
    } = req.body;

    const shipmentDimensions = {
      length: { value: Number(length) || 1 },
      breadth: { value: Number(breadth) || 1 },
      height: { value: Number(height) || 1 },
      weight: { value: Number(deadWeight || volumetricWeight) || 1 },
    };

    const token = await getAuthToken();

    // Ekart Return Payload - Exactly matching official documentation
    const ekartPayload = {
      client_name: process.env.MERCHANT_CODE || "IKK",
      goods_category: "ESSENTIAL",
      services: [
        {
          service_code: "RETURNS_SMART_CHECK",
          service_details: [
            {
              service_leg: "REVERSE",
              service_data: {
                amount_to_collect: 0,
                delivery_type: "SMALL",
                source: {
                  address: {
                    first_name: customerName,
                    address_line1: customerAddress,
                    address_line2: city,
                    pincode: pincode,
                    city: city,
                    state: state,
                    primary_contact_number: customerPhone.toString(),
                  },
                },
                destination: {
                  location_code: process.env.EKART_RETURN_LOCATION_CODE || "IKK_BLR_06",
                },
              },
              shipment: {
                client_reference_id: orderId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20),
                tracking_id: `CLTC${String(Date.now()).slice(-10)}`, 
                shipment_value: amount,
                shipment_dimensions: shipmentDimensions,
                shipment_items: products.map((item, idx) => ({
                  product_id: `SKU-${idx + 1}`,
                  category: "Apparel",
                  product_title: item.productName,
                  quantity: item.quantity,
                  cost: {
                    total_sale_value: amount,
                    total_tax_value: 0,
                    tax_breakup: {
                      cgst: "0.0",
                      sgst: "0.0",
                      igst: "0.0",
                    },
                  },
                  seller_details: {
                    seller_reg_name: "Ikkasa Concept Pvt Limite",
                    gstin_id: gstin || "",
                  },
                  hsn: hsn || "",
                  ern: "",
                  discount: "",
                  item_attributes: [
                    { name: "order_id", value: orderId },
                    { name: "invoice_id", value: invoiceId },
                  ],
                  pickup_info: {
                    reason: "OTHER_REASON",
                    sub_reason: "OTHER_REASON", 
                    reason_description: "Customer requested for Return",
                  },
                  smart_checks: [],
                })),
              },
            },
          ],
        },
      ],
    };

    console.log("Ekart return payload:", JSON.stringify(ekartPayload, null, 2));

    // Call Ekart API
    const response = await axios.post(process.env.EKART_CREATE_URL, ekartPayload, {
      headers: {
        "Content-Type": "application/json",
        HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
        Authorization: `Bearer ${token}`,
      },
    });

    // Extract tracking ID and update order
    const ekartTrackingId = response.data.response?.[0]?.tracking_id || `RET-${Date.now()}`;

    await Order.findOneAndUpdate(
      { orderId },
      {
        status: "InfoReceived",
        returnTracking: {
          currentStatus: "InfoReceived",
          history: [{ status: "InfoReceived", timestamp: new Date() }],
          ekartTrackingId,
        },
        ekartResponse: response.data,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Ekart return shipment created successfully",
      data: response.data,
    });
  } catch (error) {
    console.error("Ekart return error full message:", JSON.stringify(error?.response?.data, null, 2));
    return res.status(500).json({
      success: false,
      message: "Ekart create failed",
      details: error?.response?.data || error.message,
    });
  }
};
