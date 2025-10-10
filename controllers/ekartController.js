import axios from "axios";
import Order from "../models/Order.js";
import { getAuthToken } from "../ekartService.js";

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
    } = req.body;

    const shipmentDimensions = {
      length: { value: Number(length) || 1 },
      breadth: { value: Number(breadth) || 1 },
      height: { value: Number(height) || 1 },
      weight: { value: Number(deadWeight || volumetricWeight) || 1 },
    };

    const token = await getAuthToken();
    const trackingIdNumber = orderId.replace(/\D/g, "").padStart(10, "0").slice(-10);
    const trackingAndReferenceId = `IKKR${trackingIdNumber}`;

    // Helper to build nested checks object as per payload spec
    const buildSmartChecks = (item) => {
      // If passed as array of {code, inputs, is_mandatory}
      if (Array.isArray(item.smart_checks) && item.smart_checks.length && typeof item.smart_checks[0] === 'object' && item.smart_checks[0].code) {
        return [{
          item_title: item.productName,
          checks: item.smart_checks.reduce((acc, check) => {
            acc[check.code] = {
              inputs: check.inputs || {},
              is_mandatory: typeof check.is_mandatory === 'boolean' ? check.is_mandatory : false
            };
            return acc;
          }, {})
        }];
      }
      // Default (demo) structure for cases where no checks exist on the item — customize as needed
      return [{
        item_title: item.productName,
        checks: {
          D_DAMAGE_CTH_CHECK: { inputs: {}, is_mandatory: false },
          M_BRAND_CHECK_ON_PRODUCT_FOOTWEAR: {
            inputs: { brand_name: item.productName.split(" ")[0] },
            is_mandatory: true
          },
          M_PRODUCT_IMAGE_COLOR_PATTERN_MATCH: {
            inputs: { item_image: item.imageUrl || "" },
            is_mandatory: true
          }
        }
      }];
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
                    primary_contact_number: customerPhone ? customerPhone.toString() : "",
                  },
                },
                destination: {
                  address: {
                    first_name: "AVThamizhmahan",
                    address_line1: "3/1675 ES Garden Vazhudaretty Post Villupuram",
                    address_line2: "Tamil Nadu",
                    pincode: "400066",
                    city: "Villupuram",
                    state: "Tamil Nadu",
                    primary_contact_number: "9012345678",
                  },
                  // If you need a location_code, add here
                  // location_code: "XYZ123"
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
                  smart_checks: buildSmartChecks(item), // <--- Key Change
                })),
              },
            },
          ],
        },
      ],
    };

    console.log("Ekart return payload:", JSON.stringify(ekartPayload, null, 2));

    const response = await axios.post(process.env.EKART_CREATE_URL, ekartPayload, {
      headers: {
        "Content-Type": "application/json",
        HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
        Authorization: `Bearer ${token}`,
      },
    });

    const ekartTrackingId = response.data.response?.[0]?.tracking_id || `RET-${Date.now()}`;

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
              description: "Return request submitted to Ekart"
            }],
            ekartTrackingId,
            lastUpdated: new Date()
          },
          ekartResponse: response.data,
          updatedAt: new Date()
        }
      },
      {
        new: true,
        runValidators: true
      }
    );

    console.log("✅ Order status updated:", updatedOrder?.status);

    return res.status(200).json({
      success: true,
      message: "Ekart return shipment created successfully",
      data: response.data,
      trackingId: ekartTrackingId,
      order: updatedOrder
    });
  } catch (error) {
    console.error("Ekart return error:", JSON.stringify(error?.response?.data, null, 2));
    return res.status(500).json({
      success: false,
      message: "Ekart create failed",
      details: error?.response?.data || error.message,
    });
  }
};


// CORRECTED tracking function based on Ekart API documentation
export const trackEkartShipment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId });

    if (!order?.returnTracking?.ekartTrackingId) {
      return res.status(404).json({ 
        success: false, 
        message: "Tracking ID not found for this order" 
      });
    }

    const token = await getAuthToken();
    
    // Correct payload format as per documentation
    const trackingPayload = {
      request_id: `track_${Date.now()}`,
      tracking_ids: [order.returnTracking.ekartTrackingId]
    };

    // Use POST request with correct endpoint
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

    console.log("Ekart tracking response:", JSON.stringify(response.data, null, 2));

    // Extract tracking data for the specific tracking ID
    const trackingData = response.data[order.returnTracking.ekartTrackingId];
    
    if (!trackingData) {
      return res.status(404).json({
        success: false,
        message: "No tracking data found for this shipment"
      });
    }

    // Get the latest status from history
    const latestHistoryEntry = trackingData.history?.[0]; // History is in reverse chronological order
    const currentStatus = latestHistoryEntry?.status || "Unknown";
    const statusDescription = latestHistoryEntry?.public_description || "Status updated";

    // Update order with complete tracking information
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          "returnTracking.currentStatus": currentStatus,
          "returnTracking.lastUpdated": new Date(),
          "returnTracking.fullTrackingData": trackingData
        },
        $push: {
          "returnTracking.history": { 
            status: currentStatus, 
            timestamp: new Date(latestHistoryEntry?.event_date || new Date()),
            description: statusDescription,
            city: latestHistoryEntry?.city,
            hubName: latestHistoryEntry?.hub_name
          }
        }
      },
      { new: true }
    );

    console.log("✅ Tracking updated for order:", orderId, "Status:", currentStatus);

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
          expectedDeliveryDate: trackingData.expected_delivery_date
        }
      },
      order: updatedOrder.returnTracking,
      message: "Tracking status updated successfully"
    });
  } catch (err) {
    console.error("Tracking update error:", err?.response?.data || err.message);
    res.status(500).json({ 
      success: false, 
      message: "Tracking update failed", 
      error: err?.response?.data || err.message 
    });
  }
};

// Bulk tracking function for multiple orders
export const bulkTrackShipments = async (req, res) => {
  try {
    const { trackingIds } = req.body; // Array of tracking IDs

    if (!trackingIds || !Array.isArray(trackingIds)) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of tracking IDs"
      });
    }

    const token = await getAuthToken();
    
    const trackingPayload = {
      request_id: `bulk_track_${Date.now()}`,
      tracking_ids: trackingIds
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
      message: "Bulk tracking data retrieved successfully"
    });
  } catch (err) {
    console.error("Bulk tracking error:", err?.response?.data || err.message);
    res.status(500).json({ 
      success: false, 
      message: "Bulk tracking failed", 
      error: err?.response?.data || err.message 
    });
  }
};

// Get order tracking by order ID (frontend helper)
export const getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId }).select('returnTracking status');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    res.json({
      success: true,
      tracking: order.returnTracking,
      orderStatus: order.status
    });
  } catch (error) {
    console.error("Get tracking error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve tracking information",
      error: error.message
    });
  }
};
