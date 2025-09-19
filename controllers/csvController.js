import fs from "fs";
import csvParser from "csv-parser";
import xlsx from "xlsx";
import Order from "../models/Order.js";
import { calcVolumetricWeight } from "../utils/calcVolWeight.js";

export const uploadAndMergeCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "File is required" });
    }

    const fileExt = req.file.originalname.split(".").pop().toLowerCase();
    let results = [];

    if (fileExt === "csv") {
      // Parse CSV
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on("data", (row) => results.push(row))
        .on("end", async () => {
          await processRowsAndRespond(results, req, res);
        });
    } else if (fileExt === "xls" || fileExt === "xlsx") {
      // Parse Excel
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0]; // first sheet
      const worksheet = workbook.Sheets[sheetName];
      results = xlsx.utils.sheet_to_json(worksheet);
      await processRowsAndRespond(results, req, res);
    } else {
      // Unsupported file type
      fs.unlinkSync(req.file.path);
      return res
        .status(400)
        .json({ success: false, error: "Unsupported file type" });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

async function processRowsAndRespond(results, req, res) {
  try {
    const updatePromises = results.map(async (row) => {
      const orderId = row["Order no"]?.toString().trim();
      if (!orderId) return null;

      const length = row["length (CM)"] ? parseFloat(row["length (CM)"]) : undefined;
      const breadth = row["width (CM)"] ? parseFloat(row["width (CM)"]) : undefined;
      const height = row["height (CM)"] ? parseFloat(row["height (CM)"]) : undefined;

      const updateData = {
        awb: row["AWB"] || undefined,
        customerName: row["Customer Name"] || undefined,
        customerPhone: row["mobile"] || undefined,
        customerAddress: row["Address"] || undefined,
        city: row["City"] || undefined,
        state: row["State"] || undefined,
        pincode: row["Pincode"] || undefined,
        deadWeight: row["Weight"] ? parseFloat(row["Weight"]) : undefined,
        length,
        breadth,
        height,
        volumetricWeight:
          length && breadth && height
            ? calcVolumetricWeight(length, breadth, height)
            : undefined,
        products: row["product Name"]
          ? [{ productName: row["product Name"], quantity: parseInt(row["Box QTY"]) || 1 }]
          : undefined,
        amount: row["Package amount"] ? parseFloat(row["Package amount"]) : undefined,
        paymentMode: row["COD amount"] && parseFloat(row["COD amount"]) > 0 ? "COD" : "PREPAID",
        cgst: row["CGST"] ? parseFloat(row["CGST"]) : undefined,
        sgst: row["SGST"] ? parseFloat(row["SGST"]) : undefined,
        igst: row["IGST"] ? parseFloat(row["IGST"]) : undefined,
        hsnCode: row["hsn_code"] || undefined,
        gstinNumber: row["GSTIN Number"] || undefined,
        category: row["Category"] || undefined,
        unitPrice: row["Unit Price"] ? parseFloat(row["Unit Price"]) : undefined,

        pickupAddress: row["Pickup Facility Name"] || row["Address"] || undefined,
        pickupCity: row["Pickup City"] || row["City"] || undefined,
        pickupState: row["Pickup State"] || row["State"] || undefined,
        pickupPincode: row["Pickup Pincode"] || row["Pincode"] || undefined,

        returnLabel1: row["Return Label Line 1"] || undefined,
        returnLabel2: row["Return Label Line 2"] || undefined,
        serviceTier: row["ServiceTier"] || undefined,
        invoiceReference: row["invoice_reference"] || undefined,
      };

      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key]
      );

      const updated = await Order.findOneAndUpdate(
        { orderId },
        { $set: updateData },
        { new: true }
      );

      return updated;
    });

    const updatedOrders = (await Promise.all(updatePromises)).filter(Boolean);
    fs.unlinkSync(req.file.path);

    return res.json({
      success: true,
      updatedOrders,
      count: updatedOrders.length,
    });
  } catch (err) {
    console.error("CSV merge error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
