import express from "express";
import multer from "multer";
import { uploadAndMergeCSV } from "../controllers/csvController.js";

const router = express.Router();
const upload = multer({ dest: "upload/" });


router.post("/upload-merge", upload.single("file"), uploadAndMergeCSV);

export default router;
