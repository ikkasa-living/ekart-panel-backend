import axios from "axios";
import Order from "../models/Order.js";
import { getAuthToken } from "../ekartService.js";

function extractEkartErrorMessage(err) {
  const ekartMsg = err?.response?.data?.response?.[0]?.message
    ? err.response.data.response[0].message.join(", ")
    : null;
  return ekartMsg || err?.response?.data?.message || err?.message || "Unknown Ekart error";
}

// ✅ FIXED: trackEkartShipment - Only updates tracking, preserves status
export const trackEkartShipment = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // ✅ Find order by orderId
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

    console.log("📍 Fetching tracking for:", {
      orderId,
      ekartTrackingId: order.returnTracking.ekartTrackingId,
    });

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

    // ✅ CRITICAL FIX: Only update returnTracking, PRESERVE status field
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          // ✅ UPDATE: Only tracking info
          "returnTracking.currentStatus": currentStatus,
          "returnTracking.lastUpdated": new Date(),
          "returnTracking.fullTrackingData": trackingData,
          // ✅ DO NOT CHANGE: status field stays as is (RETURN_REQUESTED)
        },
        // ✅ APPEND: Add to history array, don't replace it
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

    console.log("✅ Order tracking updated:", {
      orderId,
      newTrackingStatus: currentStatus,
      preservedOrderStatus: updatedOrder.status, // ✅ Should still be RETURN_REQUESTED
    });

    res.json({
      success: true,
      tracking: updatedOrder.returnTracking,
      order: updatedOrder,  // ✅ Return full order with preserved status
      orderStatus: updatedOrder.status,  // ✅ Original status preserved
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

// ✅ NEW: Retry failed return - Reset and prepare for new pickup
export const retryFailedReturn = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // ✅ Check if pickup was actually cancelled
    const lastTracking = order.returnTracking;
    if (lastTracking?.currentStatus !== "Reverse pickup cancelled") {
      return res.status(400).json({
        success: false,
        message: `Cannot retry. Current status: ${lastTracking?.currentStatus || "No tracking"}`,
        currentStatus: lastTracking?.currentStatus,
      });
    }

    console.log("🔄 Resetting failed return for orderId:", orderId);

    // ✅ Clear failed return data - Reset to allow new return
    const resetOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          status: "New",  // Reset to new
          returnTracking: {
            currentStatus: "",
            history: [],
            ekartTrackingId: "",
            lastUpdated: new Date(),
          },
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    console.log("✅ Return reset successfully for:", orderId);

    res.json({
      success: true,
      message: "Return reset. You can now create a new return request.",
      order: resetOrder,
    });

  } catch (error) {
    console.error("❌ Retry failed return error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset return",
      error: error.message,
    });
  }
};

// ✅ NEW: Reschedule pickup - Try creating new return for same order
export const reschedulePickup = async (req, res) => {
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
      hsnCode,
      invoiceReference,
      destinationName,
      destinationAddressLine1,
      destinationAddressLine2,
      destinationCity,
      destinationState,
      destinationPincode,
      destinationPhone,
    } = req.body;

    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // ✅ Check if this is a retry
    if (order.returnTracking?.currentStatus !== "Reverse pickup cancelled") {
      return res.status(400).json({
        success: false,
        message: "Can only reschedule cancelled pickups",
        currentStatus: order.returnTracking?.currentStatus,
      });
    }

    console.log("📍 Attempting to reschedule pickup for:", orderId);

    // ✅ Prepare new return payload (same as createEkartReturn)
    const token = await getAuthToken();
    const trackingIdNumber = orderId.replace(/\D/g, "").padStart(10, "0").slice(-10);
    const trackingAndReferenceId = `IKKR${trackingIdNumber}`;

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
                    first_name: customerName || "Customer",
                    address_line1: customerAddress || "",
                    address_line2: city || "",
                    pincode: pincode || "",
                    city: city || "",
                    state: state || "",
                    primary_contact_number: customerPhone?.toString() || "",
                  },
                },
                destination: {
                  address: {
                    first_name: destinationName || "Ikkasa Warehouse",
                    address_line1: destinationAddressLine1 || "Warehouse",
                    address_line2: destinationAddressLine2 || "",
                    pincode: destinationPincode || "",
                    city: destinationCity || "",
                    state: destinationState || "",
                    primary_contact_number: destinationPhone || "",
                  },
                },
              },
              shipment: {
                client_reference_id: trackingAndReferenceId,
                tracking_id: trackingAndReferenceId,
                shipment_value: amount || 0,
                shipment_dimensions: {
                  length: { value: length || 20 },
                  breadth: { value: breadth || 20 },
                  height: { value: height || 10 },
                  weight: { value: deadWeight || 1 },
                },
                shipment_items: (products || []).map((item, idx) => ({
                  product_id: `SKU-${idx + 1}`,
                  category: "Apparel",
                  product_title: item.productName || "Product",
                  quantity: item.quantity || 1,
                  cost: {
                    total_sale_value: amount || 0,
                    total_tax_value: 0,
                    tax_breakup: {
                      cgst: "0.0",
                      sgst: "0.0",
                      igst: "0.0",
                    },
                  },
                  seller_details: {
                    seller_reg_name: "Ikkasa Concept Pvt Limited",
                    gstin_id: "",
                  },
                  hsn: hsnCode || "",
                  ern: "",
                  discount: "",
                  item_attributes: [
                    { name: "order_id", value: orderId },
                    { name: "invoice_id", value: invoiceReference || "" },
                  ],
                  pickup_info: {
                    reason: "OTHER_REASON",
                    sub_reason: "OTHER_REASON",
                    reason_description: "Customer requested retry after cancelled pickup",
                  },
                  smart_checks: item.smart_checks || [
                    {
                      item_title: item.productName || "Product",
                      checks: {
                        D_DAMAGE_CTH_CHECK: { inputs: {}, is_mandatory: false },
                      },
                    },
                  ],
                })),
              },
            },
          ],
        },
      ],
    };

    console.log("📤 Sending reschedule payload to Ekart...");

    // ✅ Call Ekart API
    const ekartResponse = await axios.post(
      process.env.EKART_CREATE_URL,
      ekartPayload,
      {
        headers: {
          "Content-Type": "application/json",
          HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const ekartResp = ekartResponse.data;

    // ✅ Check Ekart response
    if (ekartResp?.response && ekartResp.response[0]?.status !== "REQUEST_ACCEPTED") {
      console.error("❌ Ekart rejected reschedule:", ekartResp.response[0]);
      return res.status(400).json({
        success: false,
        message: ekartResp.response[0]?.message?.join(", ") || "Ekart rejected reschedule request",
        errorType: "NO_VENDOR_SERVICEABILITY",
        details: ekartResp,
      });
    }

    const newTrackingId = ekartResp.response?.[0]?.tracking_id || `RET-${Date.now()}`;

    // ✅ Update order with new tracking
    const rescheduledOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          status: "RETURN_REQUESTED",
          returnTracking: {
            currentStatus: "Rescheduled - Pickup Requested",
            history: [
              {
                status: "Rescheduled - Pickup Requested",
                timestamp: new Date(),
                description: "Return rescheduled after previous cancellation",
              },
            ],
            ekartTrackingId: newTrackingId,
            lastUpdated: new Date(),
            previousAttemptCancelled: true,
            cancelledDate: order.returnTracking?.lastUpdated,
          },
          ekartResponse: ekartResp,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    console.log("✅ Reschedule successful with new tracking ID:", newTrackingId);

    res.json({
      success: true,
      message: "Pickup rescheduled successfully!",
      trackingId: newTrackingId,
      order: rescheduledOrder,
      orderStatus: rescheduledOrder.status,
    });

  } catch (error) {
    console.error("❌ Reschedule error:", error);
    const errReason = extractEkartErrorMessage(error);
    
    res.status(500).json({
      success: false,
      message: `Reschedule failed: ${errReason}`,
      details: error?.response?.data || error.message,
    });
  }
};

// Keep other existing functions
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

// ✅ NEW: Create return (keep existing implementation)
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
      hsnCode,
      invoiceReference,
      destinationName,
      destinationAddressLine1,
      destinationAddressLine2,
      destinationCity,
      destinationState,
      destinationPincode,
      destinationPhone,
    } = req.body;

    const order = await Order.findOne({ orderId });
    const destination = {
      name: destinationName || order?.destinationName || "Ikkasa Warehouse",
      addressLine1: destinationAddressLine1 || order?.destinationAddressLine1 || "Warehouse Address",
      addressLine2: destinationAddressLine2 || order?.destinationAddressLine2 || "",
      city: destinationCity || order?.destinationCity || "",
      state: destinationState || order?.destinationState || "",
      pincode: destinationPincode || order?.destinationPincode || "",
      phone: destinationPhone || order?.destinationPhone || "",
    };

    const token = await getAuthToken();
    const trackingIdNumber = orderId.replace(/\D/g, "").padStart(10, "0").slice(-10);
    const trackingAndReferenceId = `IKKR${trackingIdNumber}`;

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
                shipment_dimensions: {
                  length: { value: length },
                  breadth: { value: breadth },
                  height: { value: height },
                  weight: { value: deadWeight },
                },
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
                    gstin_id: "",
                  },
                  hsn: hsnCode || "",
                  ern: "",
                  discount: "",
                  item_attributes: [
                    { name: "order_id", value: orderId },
                    { name: "invoice_id", value: invoiceReference || "" },
                  ],
                  pickup_info: {
                    reason: "OTHER_REASON",
                    sub_reason: "OTHER_REASON",
                    reason_description: "Customer requested for Return",
                  },
                  smart_checks: item.smart_checks || [
                    {
                      item_title: item.productName,
                      checks: {
                        D_DAMAGE_CTH_CHECK: { inputs: {}, is_mandatory: false },
                      },
                    },
                  ],
                })),
              },
            },
          ],
        },
      ],
    };

    console.log("📤 Creating Ekart return for:", orderId);

    const ekartResponse = await axios.post(
      process.env.EKART_CREATE_URL,
      ekartPayload,
      {
        headers: {
          "Content-Type": "application/json",
          HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const ekartResp = ekartResponse.data;

    if (ekartResp?.response && ekartResp.response[0]?.status !== "REQUEST_ACCEPTED") {
      const errorMsg = ekartResp.response[0]?.message?.join(", ") || "Request rejected";
      console.error("❌ Ekart rejected request:", errorMsg);

      if (errorMsg.includes("No vendor has pickup serviceability")) {
        return res.status(400).json({
          success: false,
          message: "Return cannot be processed for this location",
          details: "Ekart doesn't have pickup service in this area. Please provide an alternative address.",
          errorType: "NO_VENDOR_SERVICEABILITY",
          customerMessage: "We cannot arrange pickup from your current location. Please provide a different address within a serviceable area.",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Ekart rejected the return request",
        details: errorMsg,
        errorType: "REQUEST_REJECTED",
      });
    }

    const trackingId = ekartResp.response?.[0]?.tracking_id;

    const updatedOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          status: "RETURN_REQUESTED",
          returnTracking: {
            currentStatus: "Return Initiated",
            history: [{
              status: "Return Initiated",
              timestamp: new Date(),
              description: "Return request submitted to Ekart",
            }],
            ekartTrackingId: trackingId,
            lastUpdated: new Date(),
          },
          ekartResponse: ekartResp,
          updatedAt: new Date(),
        },
      },
      { new: true }
    );

    console.log("✅ Return created successfully with tracking ID:", trackingId);

    res.json({
      success: true,
      message: "Ekart return shipment created successfully",
      trackingId: trackingId,
      order: updatedOrder,
      orderStatus: updatedOrder.status,
    });

  } catch (err) {
    const errReason = extractEkartErrorMessage(err);
    console.error("❌ Error creating return:", errReason);
    res.status(500).json({
      success: false,
      message: `Failed to create return: ${errReason}`,
      error: err?.response?.data || err.message,
    });
  }
};