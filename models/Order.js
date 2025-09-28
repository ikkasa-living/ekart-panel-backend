import mongoose from "mongoose";

const orderProductSchema = new mongoose.Schema({
  productName: { type: String, required: true },
  quantity: { type: Number, required: true },
});

const returnTrackingHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const orderSchema = new mongoose.Schema(
  {
    shopifyId: { type: String, unique: true, sparse: true },
    orderId: { type: String, unique: true, sparse: true },
    orderDate: { type: Date, default: Date.now },

    awb: { type: String },

    customerName: { type: String },
    customerPhone: { type: String },
    customerEmail: { type: String },
    customerAddress: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },

    // Destination address fields added
    destinationName: { type: String },
    destinationAddressLine1: { type: String },
    destinationAddressLine2: { type: String },
    destinationCity: { type: String },
    destinationState: { type: String },
    destinationPincode: { type: String },
    destinationPhone: { type: String },

    products: [orderProductSchema],

    deadWeight: { type: Number },
    length: { type: Number },
    breadth: { type: Number },
    height: { type: Number },
    volumetricWeight: { type: Number },

    amount: { type: Number, default: 0 },
    paymentMode: { type: String, default: "" },

    cgst: { type: Number },
    sgst: { type: Number },
    igst: { type: Number },
    hsnCode: { type: String },
    gstinNumber: { type: String },
    category: { type: String },
    unitPrice: { type: Number },
    pickupAddress: { type: String },
    pickupCity: { type: String },
    pickupState: { type: String },
    pickupPincode: { type: String },
    returnLabel1: { type: String },
    returnLabel2: { type: String },
    serviceTier: { type: String },

    invoiceReference: { type: String },

    ekartResponse: { type: Object },

    status: { type: String, default: "New" },

    returnTracking: {
      currentStatus: { type: String, default: "" },
      history: [returnTrackingHistorySchema],
      ekartTrackingId: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Ensure status is never empty or null
orderSchema.pre("save", function (next) {
  if (!this.status || this.status.trim() === "") {
    this.status = "New";
  }
  next();
});

export default mongoose.model("Order", orderSchema);
