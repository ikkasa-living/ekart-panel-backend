import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { 
  createEkartReturn, 
  trackEkartShipment, 
  bulkTrackShipments,
  getOrderTracking 
} from "../controllers/ekartController.js";

const router = express.Router();

// Setup multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// Upload route for photo uploads
router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});

// Ekart return creation route
router.post("/return", createEkartReturn);

// NEW TRACKING ROUTES
// Track a specific order's return shipment
router.get("/track/:orderId", trackEkartShipment);

// Get order tracking information (without API call)
router.get("/tracking/:orderId", getOrderTracking);

// Bulk tracking for multiple shipments
router.post("/track/bulk", bulkTrackShipments);

export default router;
