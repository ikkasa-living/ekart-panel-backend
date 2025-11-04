// restrictEmail.js
import dotenv from "dotenv";
dotenv.config();

export function restrictEmail(req, res, next) {
  const allowedEmail = (process.env.ALLOWED_EMAIL || "").toLowerCase().trim();
  const incomingEmail = (req.body?.email || "").toLowerCase().trim();

  if (!incomingEmail) {
    return res.status(400).json({ message: "Email is required." });
  }

  if (incomingEmail !== allowedEmail) {
    return res.status(403).json({ message: `Email not allowed.` });
  }

  next();
}
