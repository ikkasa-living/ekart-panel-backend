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
                  address: {
                    first_name: "AVThamizhmahan",
                    address_line1: "3/1675 ES Garden Vazhudaretty Post Villupuram",
                    address_line2: "Tamil Nadu",
                    pincode: "400066",
                    city: "Villupuram",
                    state: "Tamil Nadu",
                    primary_contact_number: "9012345678",
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
                  smart_checks: item.smart_checks || [],
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

    // Updated with proper status and timestamp handling
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
        new: true, // Return the updated document
        runValidators: true // Run schema validations
      }
    );

    console.log("✅ Order status updated:", updatedOrder?.status);

    return res.status(200).json({
      success: true,
      message: "Ekart return shipment created successfully",
      data: response.data,
      trackingId: ekartTrackingId,
      order: updatedOrder // Include updated order data
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

// Updated tracking updater API
export const updateEkartTracking = async (req, res) => {
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
    const response = await axios.get(
      `${process.env.EKART_TRACKING_URL}/${order.returnTracking.ekartTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          HTTP_X_MERCHANT_CODE: process.env.MERCHANT_CODE,
        },
      }
    );

    const latestStatus = response.data?.status || "Unknown";
    const statusDescription = response.data?.description || "Status updated";

    // Update tracking with new status
    const updatedOrder = await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          "returnTracking.currentStatus": latestStatus,
          "returnTracking.lastUpdated": new Date()
        },
        $push: {
          "returnTracking.history": { 
            status: latestStatus, 
            timestamp: new Date(),
            description: statusDescription
          }
        }
      },
      { new: true }
    );

    console.log("✅ Tracking updated for order:", orderId, "Status:", latestStatus);

    res.json({ 
      success: true, 
      tracking: updatedOrder.returnTracking,
      message: "Tracking status updated successfully"
    });
  } catch (err) {
    console.error("Tracking update error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Tracking update failed", 
      error: err.message 
    });
  }
};