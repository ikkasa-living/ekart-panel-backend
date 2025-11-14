import axios from "axios";
import Order from "../models/Order.js";
import { getAuthToken } from "../ekartService.js";

function extractEkartErrorMessage(err) {
  const ekartMsg = err?.response?.data?.response?.[0]?.message
    ? err.response.data.response[0].message.join(", ")
    : null;
  return ekartMsg || err?.response?.data?.message || err?.message || "Unknown Ekart error";
}

function generateUniqueTrackingId(orderId) {
  const orderNumber = orderId.replace(/\D/g, "").slice(-6) || "000000";
  const timestamp = Date.now().toString().slice(-4);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  
  const trackingId = `IKKR${orderNumber}${timestamp}${random}`;
  console.log("📌 Generated unique tracking ID:", trackingId, "for order:", orderId);
  return trackingId;
}

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

    console.log("✅ Order tracking updated:", {
      orderId,
      newTrackingStatus: currentStatus,
      preservedOrderStatus: updatedOrder.status,
    });

    res.json({
      success: true,
      tracking: updatedOrder.returnTracking,
      order: updatedOrder,
      orderStatus: updatedOrder.status,
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

    const lastTracking = order.returnTracking;
    if (lastTracking?.currentStatus !== "Reverse pickup cancelled") {
      return res.status(400).json({
        success: false,
        message: `Cannot retry. Current status: ${lastTracking?.currentStatus || "No tracking"}`,
        currentStatus: lastTracking?.currentStatus,
      });
    }

    console.log("🔄 Resetting failed return for orderId:", orderId);

    const resetOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          status: "New",
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

    if (order.returnTracking?.currentStatus !== "Reverse pickup cancelled") {
      return res.status(400).json({
        success: false,
        message: "Can only reschedule cancelled pickups",
        currentStatus: order.returnTracking?.currentStatus,
      });
    }

    console.log("📍 Attempting to reschedule pickup for:", orderId);

    const token = await getAuthToken();
    const trackingAndReferenceId = generateUniqueTrackingId(orderId);

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
    console.log("   Tracking ID:", trackingAndReferenceId);

    let ekartResponse;
    try {
      ekartResponse = await axios.post(
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
    } catch (ekartError) {
      console.error("❌ Ekart API Error (reschedule):");
      console.error("   Status:", ekartError?.response?.status);
      console.error("   Data:", JSON.stringify(ekartError?.response?.data, null, 2));
      
      const errReason = extractEkartErrorMessage(ekartError);
      return res.status(400).json({
        success: false,
        message: `Ekart API Error: ${errReason}`,
        errorType: "EKART_API_ERROR",
      });
    }

    const ekartResp = ekartResponse.data;

    console.log("📥 Ekart Reschedule Response:");
    console.log("   Full Response:", JSON.stringify(ekartResp, null, 2));

    const responseArray = ekartResp?.response || [];
    const firstResponse = responseArray?.[0];

    if (firstResponse?.status === "REQUEST_ACCEPTED" || firstResponse?.status === "REQUEST_RECEIVED") {
      console.log("✅ Ekart ACCEPTED reschedule request!");
      
      const newTrackingId = firstResponse?.tracking_id || trackingAndReferenceId;

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
                  previousTrackingId: order.returnTracking?.ekartTrackingId,
                },
              ],
              ekartTrackingId: newTrackingId,
              lastUpdated: new Date(),
              previousAttemptCancelled: true,
              cancelledDate: order.returnTracking?.lastUpdated,
              rescheduledAt: new Date(),
              retryCount: (order.returnTracking?.retryCount || 0) + 1,
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

    } else {
      const errorMsg = firstResponse?.message?.join?.(", ") || "Ekart rejected reschedule";
      console.error("❌ Ekart rejected reschedule:", errorMsg);
      
      return res.status(400).json({
        success: false,
        message: `Ekart rejected: ${errorMsg}`,
        errorType: "RESCHEDULE_REJECTED",
      });
    }

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

    console.log("📤 Creating Ekart return for:", orderId);

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
    const trackingAndReferenceId = generateUniqueTrackingId(orderId);

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

    console.log("📤 Sending return payload to Ekart...");
    console.log("   Tracking ID:", trackingAndReferenceId);

    let ekartResponse;
    try {
      ekartResponse = await axios.post(
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
    } catch (ekartError) {
      console.error("❌ Ekart API Error (try-catch):");
      console.error("   Status:", ekartError?.response?.status);
      console.error("   Data:", JSON.stringify(ekartError?.response?.data, null, 2));
      
      const errReason = extractEkartErrorMessage(ekartError);
      return res.status(400).json({
        success: false,
        message: `Ekart API Error: ${errReason}`,
        errorType: "EKART_API_ERROR",
        details: ekartError?.response?.data,
      });
    }

    const ekartResp = ekartResponse.data;

    console.log("📥 Ekart Response Received:");
    console.log("   Full Response:", JSON.stringify(ekartResp, null, 2));

    const responseArray = ekartResp?.response || [];
    const firstResponse = responseArray?.[0];

    console.log("📊 Response Analysis:");
    console.log("   Response Array:", responseArray);
    console.log("   First Response:", firstResponse);
    console.log("   Status:", firstResponse?.status);

    if (firstResponse?.status === "REQUEST_ACCEPTED" || firstResponse?.status === "REQUEST_RECEIVED") {
      console.log("✅ Ekart ACCEPTED the request!");
      
      const trackingId = firstResponse?.tracking_id || trackingAndReferenceId;

      console.log("✅ Ekart accepted request. Saving to database...");
      console.log("   Tracking ID:", trackingId);

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
              retryCount: 0,
            },
            ekartResponse: ekartResp,
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      console.log("✅ Return created successfully in DB with tracking ID:", trackingId);

      res.json({
        success: true,
        message: "Ekart return shipment created successfully",
        trackingId: trackingId,
        order: updatedOrder,
        orderStatus: updatedOrder.status,
      });

    } else {
      const errorMsg = firstResponse?.message?.join?.(", ") || 
                       firstResponse?.message || 
                       ekartResp?.message ||
                       "Ekart rejected request";
      
      console.error("❌ Ekart Rejected Request:");
      console.error("   Status:", firstResponse?.status);
      console.error("   Message:", errorMsg);

      if (errorMsg?.includes("No vendor has pickup serviceability")) {
        return res.status(400).json({
          success: false,
          message: "Return cannot be processed for this location",
          details: "Ekart doesn't have pickup service in this area.",
          errorType: "NO_VENDOR_SERVICEABILITY",
        });
      }

      if (errorMsg?.includes("Shipment already present")) {
        return res.status(400).json({
          success: false,
          message: "Tracking ID already exists. Try again.",
          errorType: "DUPLICATE_SHIPMENT",
        });
      }

      return res.status(400).json({
        success: false,
        message: `Ekart rejected: ${errorMsg}`,
        details: errorMsg,
        errorType: "REQUEST_REJECTED",
      });
    }

  } catch (err) {
    console.error("❌ Unexpected Error:", err.message);
    const errReason = extractEkartErrorMessage(err);
    
    res.status(500).json({
      success: false,
      message: `Failed to create return: ${errReason}`,
      error: err?.response?.data || err.message,
    });
  }
};