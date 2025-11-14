import axios from "axios";
import Order from "../models/Order.js";
import { getAuthToken } from "../ekartService.js";

function extractEkartErrorMessage(err) {
  const ekartMsg = err?.response?.data?.response?.[0]?.message
    ? err.response.data.response[0].message.join(", ")
    : null;
  return ekartMsg || err?.response?.data?.message || err?.message || "Unknown Ekart error";
}

export const createEkartReturn = async (req, res) => {
  try {
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
      destinationName,
      destinationAddressLine1,
      destinationAddressLine2,
      destinationCity,
      destinationState,
      destinationPincode,
      destinationPhone,
    } = req.body;

    // Load order from DB (to fill missing destination details if needed)
    const order = await Order.findOne({ orderId });

    const destination = {
      name:
        destinationName ||
        order?.destinationName ||
        "Ikkasa Warehouse",
      addressLine1:
        destinationAddressLine1 ||
        order?.destinationAddressLine1 ||
        "No address provided",
      addressLine2:
        destinationAddressLine2 ||
        order?.destinationAddressLine2 ||
        "",
      pincode:
        destinationPincode ||
        order?.destinationPincode ||
        "",
      city:
        destinationCity ||
        order?.destinationCity ||
        "",
      state:
        destinationState ||
        order?.destinationState ||
        "",
      phone:
        destinationPhone ||
        order?.destinationPhone ||
        "",
    };

    const shipmentDimensions = {
      length: { value: Number(length) || 1 },
      breadth: { value: Number(breadth) || 1 },
      height: { value: Number(height) || 1 },
      weight: { value: Number(deadWeight || volumetricWeight) || 1 },
    };

    const token = await getAuthToken();
    const trackingIdNumber = orderId.replace(/\D/g, "").padStart(10, "0").slice(-10);
    const trackingAndReferenceId = `IKKR${trackingIdNumber}`;

    // Helper to create smart checks
    const buildSmartChecks = (item) => {
      if (
        Array.isArray(item.smart_checks) &&
        item.smart_checks.length &&
        typeof item.smart_checks[0] === "object" &&
        item.smart_checks[0].code
      ) {
        return [
          {
            item_title: item.productName,
            checks: item.smart_checks.reduce((acc, check) => {
              acc[check.code] = {
                inputs: check.inputs || {},
                is_mandatory:
                  typeof check.is_mandatory === "boolean" ? check.is_mandatory : false,
              };
              return acc;
            }, {}),
          },
        ];
      }
      return [
        {
          item_title: item.productName,
          checks: {
            D_DAMAGE_CTH_CHECK: { inputs: {}, is_mandatory: false },
            M_BRAND_CHECK_ON_PRODUCT_FOOTWEAR: {
              inputs: { brand_name: item.productName.split(" ")[0] },
              is_mandatory: true,
            },
            M_PRODUCT_IMAGE_COLOR_PATTERN_MATCH: {
              inputs: { item_image: item.imageUrl || "" },
              is_mandatory: true,
            },
          },
        },
      ];
    };

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
                    primary_contact_number: customerPhone?.toString() || "",
                  },
                },
                destination: {
                  address: {
                    first_name: destination.name,
                    address_line1: destination.addressLine1,
                    address_line2: destination.addressLine2,
                    pincode: destination.pincode,
                    city: destination.city,
                    state: destination.state,
                    primary_contact_number: destination.phone,
                  },
                },
              },
              shipment: {
                client_reference_id: trackingAndReferenceId,
                tracking_id: trackingAndReferenceId,
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
                    seller_reg_name: "Ikkasa Concept Pvt Limited",
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
                  smart_checks: buildSmartChecks(item),
                })),
              },
            },
          ],
        },
      ],
    };

    console.log("🟢 Ekart return payload:\n", JSON.stringify(ekartPayload, null, 2));

    const response = await axios.post(process.env.EKART_CREATE_URL, ekartPayload, {
      headers: {
        "Content-Type": "application/json",
        HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
        Authorization: `Bearer ${token}`,
      },
    });

    const ekartResp = response.data;

    // ✅ FIXED: Better error handling
    if (ekartResp?.response && ekartResp.response[0]?.status !== "REQUEST_ACCEPTED") {
      console.error("❌ Ekart rejected return request:", ekartResp.response[0]);
      return res.status(400).json({
        success: false,
        message:
          ekartResp.response[0]?.message?.join(", ") ||
          "Ekart rejected return request",
        details: ekartResp,
      });
    }

    const ekartTrackingId = ekartResp.response?.[0]?.tracking_id || `RET-${Date.now()}`;

    // ✅ FIXED: Use findOneAndUpdate with 'new: true' to get updated document
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          status: "RETURN_REQUESTED", // ✅ Set status here
          returnTracking: {
            currentStatus: "Return Initiated",
            history: [
              {
                status: "Return Initiated",
                timestamp: new Date(),
                description: "Return request submitted to Ekart",
              },
            ],
            ekartTrackingId,
            lastUpdated: new Date(),
          },
          ekartResponse: ekartResp,
          updatedAt: new Date(),
        },
      },
      { new: true, runValidators: true } // ✅ CRITICAL: Returns updated document
    );

    console.log("✅ Order status updated to RETURN_REQUESTED:", updatedOrder?.status);
    console.log("✅ Tracking ID:", ekartTrackingId);

    // ✅ FIXED: Return the complete updated order object
    return res.status(200).json({
      success: true,
      message: "Ekart return shipment created successfully",
      data: ekartResp,
      trackingId: ekartTrackingId,
      order: updatedOrder, // ✅ Return full updated order
      orderStatus: updatedOrder?.status, // ✅ Also explicitly include status
    });
  } catch (error) {
    const errReason = extractEkartErrorMessage(error);
    console.error("❌ Ekart return error:", JSON.stringify(error?.response?.data, null, 2));
    return res.status(500).json({
      success: false,
      message: `Ekart create failed: ${errReason}`,
      details: error?.response?.data || error.message,
    });
  }
};

export const trackEkartShipment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId });

    if (!order?.returnTracking?.ekartTrackingId) {
      return res.status(404).json({
        success: false,
        message: "Tracking ID not found for this order",
      });
    }

    const token = await getAuthToken();

    const trackingPayload = {
      request_id: `track_${Date.now()}`,
      tracking_ids: [order.returnTracking.ekartTrackingId],
    };

    const response = await axios.post(
      `${process.env.EKART_API_BASE}/v2/shipments/track`,
      trackingPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
        },
      }
    );

    console.log("📦 Ekart tracking response:", JSON.stringify(response.data, null, 2));

    const trackingData = response.data[order.returnTracking.ekartTrackingId];

    if (!trackingData) {
      return res.status(404).json({
        success: false,
        message: "No tracking data found for this shipment",
      });
    }

    const latestHistoryEntry = trackingData.history?.[0];
    const currentStatus = latestHistoryEntry?.status || "Unknown";
    const statusDescription = latestHistoryEntry?.public_description || "Status updated";

    const updatedOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          "returnTracking.currentStatus": currentStatus,
          "returnTracking.lastUpdated": new Date(),
          "returnTracking.fullTrackingData": trackingData,
        },
        $push: {
          "returnTracking.history": {
            status: currentStatus,
            timestamp: new Date(latestHistoryEntry?.event_date || new Date()),
            description: statusDescription,
            city: latestHistoryEntry?.city,
            hubName: latestHistoryEntry?.hub_name,
          },
        },
      },
      { new: true }
    );

    res.json({
      success: true,
      tracking: {
        currentStatus,
        lastUpdated: new Date(),
        history: trackingData.history,
        shipmentDetails: {
          delivered: trackingData.delivered,
          shipmentValue: trackingData.shipment_value,
          currentHub: trackingData.current_hub,
          expectedDeliveryDate: trackingData.expected_delivery_date,
        },
      },
      order: updatedOrder.returnTracking,
      message: "Tracking status updated successfully",
    });
  } catch (err) {
    const errReason = extractEkartErrorMessage(err);
    console.error("❌ Tracking update error:", err?.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: `Tracking update failed: ${errReason}`,
      error: err?.response?.data || err.message,
    });
  }
};

export const bulkTrackShipments = async (req, res) => {
  try {
    const { trackingIds } = req.body;

    if (!trackingIds || !Array.isArray(trackingIds)) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of tracking IDs",
      });
    }

    const token = await getAuthToken();
    const trackingPayload = {
      request_id: `bulk_track_${Date.now()}`,
      tracking_ids: trackingIds,
    };

    const response = await axios.post(
      `${process.env.EKART_API_BASE}/v2/shipments/track`,
      trackingPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
        },
      }
    );

    res.json({
      success: true,
      trackingData: response.data,
      message: "Bulk tracking data retrieved successfully",
    });
  } catch (err) {
    const errReason = extractEkartErrorMessage(err);
    console.error("❌ Bulk tracking error:", err?.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: `Bulk tracking failed: ${errReason}`,
      error: err?.response?.data || err.message,
    });
  }
};

export const getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId }).select("returnTracking status");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      tracking: order.returnTracking,
      orderStatus: order.status,
    });
  } catch (error) {
    const errReason = extractEkartErrorMessage(error);
    console.error("❌ Get tracking error:", error);
    res.status(500).json({
      success: false,
      message: `Failed to retrieve tracking information: ${errReason}`,
      error: error.message,
    });
  }
};