import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  // Expect: Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token missing." });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Store user info in request
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}
