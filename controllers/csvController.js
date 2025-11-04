import fs from "fs";
import csvParser from "csv-parser";
import xlsx from "xlsx";
import Order from "../models/Order.js";
import { calcVolumetricWeight } from "../utils/calcVolWeight.js";

export const uploadAndMergeCSV = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "File is required" });
    }

    const fileExt = req.file.originalname.split(".").pop().toLowerCase();
    let results = [];

    if (fileExt === "csv") {
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on("data", (row) => results.push(row))
        .on("end", async () => {
          await processRowsAndRespond(results, req, res);
        });
    } else if (fileExt === "xls" || fileExt === "xlsx") {
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      results = xlsx.utils.sheet_to_json(worksheet);
      await processRowsAndRespond(results, req, res);
    } else {
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
      const orderId = row["Order no"]?.toString().trim().replace(/^#/, "");
      if (!orderId) return null;

      // First, get the existing order to preserve existing data
      const existingOrder = await Order.findOne({ orderId });

      const length = row["length (CM)"]
        ? parseFloat(row["length (CM)"])
        : undefined;
      const breadth = row["width (CM)"]
        ? parseFloat(row["width (CM)"])
        : undefined;
      const height = row["height (CM)"]
        ? parseFloat(row["height (CM)"])
        : undefined;

      // Prepare update data - only include fields that have values
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
        amount: row["Package amount"]
          ? parseFloat(row["Package amount"])
          : undefined,
        paymentMode:
          row["COD amount"] && parseFloat(row["COD amount"]) > 0
            ? "COD"
            : "PREPAID",
        cgst: row["CGST"] ? parseFloat(row["CGST"]) : undefined,
        sgst: row["SGST"] ? parseFloat(row["SGST"]) : undefined,
        igst: row["IGST"] ? parseFloat(row["IGST"]) : undefined,
        hsnCode: row["hsn_code"] || undefined,
        gstinNumber: row["GSTIN Number"] || undefined,
        category: row["Category"] || undefined,
        unitPrice: row["Unit Price"]
          ? parseFloat(row["Unit Price"])
          : undefined,
        pickupAddress: (row["Customer Name"] && row["Address"]) || undefined,
        pickupCity: row["Pickup City"] || row["City"] || undefined,
        pickupState: row["Pickup State"] || row["State"] || undefined,
        pickupPincode: row["Pickup Pincode"] || row["Pincode"] || undefined,
        returnLabel1: row["Return Label Line 1"] || undefined,
        returnLabel2: row["Return Label Line 2"] || undefined,
        serviceTier: row["ServiceTier"] || undefined,
        invoiceReference: row["invoice_reference"] || undefined,
        destinationName: row["Destination Name"] || undefined,
        destinationAddressLine1: row["Destination Address Line 1"] || undefined,
        destinationAddressLine2: row["Destination Address Line 2"] || undefined,
        destinationCity: row["Destination City"] || undefined,
        destinationState: row["Destination State"] || undefined,
        destinationPincode: row["Destination Pincode"] || undefined,
        destinationPhone: row["Destination Phone"] || undefined,
      };

      // Handle products array - merge with existing products if they exist
      if (row["product Name"]) {
        const newProduct = {
          productName: row["product Name"],
          quantity: parseInt(row["Box QTY"]) || 1,
          imageUrl: "", // Keep empty for CSV uploads to preserve existing imageUrl
        };

        if (existingOrder && existingOrder.products && existingOrder.products.length > 0) {
          // Merge with existing products, preserving imageUrls
          const existingProducts = existingOrder.products;
          const mergedProducts = [...existingProducts];
          
          // Check if product already exists by name
          const existingProductIndex = existingProducts.findIndex(
            p => p.productName === newProduct.productName
          );

          if (existingProductIndex !== -1) {
            // Update existing product but preserve imageUrl
            mergedProducts[existingProductIndex] = {
              ...existingProducts[existingProductIndex],
              ...newProduct,
              imageUrl: existingProducts[existingProductIndex].imageUrl || newProduct.imageUrl,
            };
          } else {
            // Add new product to existing array
            mergedProducts.push(newProduct);
          }
          
          updateData.products = mergedProducts;
        } else {
          // No existing products, add new one
          updateData.products = [newProduct];
        }
      }

      // Remove undefined values to prevent overwriting existing data
      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key]
      );

      // Use $set to update only specified fields, preserving others
      const updatedOrder = await Order.findOneAndUpdate(
        { orderId },
        { 
          $set: {
            ...updateData, 
            updatedAt: new Date() // Force timestamp update for proper sorting
          }
        },
        { 
          upsert: true, 
          new: true, 
          setDefaultsOnInsert: true,
          // Preserve existing fields that aren't being updated
          runValidators: true
        }
      );

      return updatedOrder;
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