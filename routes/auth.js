import express from "express";
import { restrictEmail } from "../middleware/restrictEmail.js";
import { signup, login } from "../controllers/authController.js";
import { requireAuth } from '../middleware/authmiddleware.js';

const router = express.Router();

// Signup route is public but restricts email
router.post("/signup", restrictEmail, signup);

// Login route is public but restricts email
router.post("/login", restrictEmail, login);

// Protect other routes requiring auth below, e.g.
// router.get("/profile", requireAuth, (req, res) => { ... });

export default router;
