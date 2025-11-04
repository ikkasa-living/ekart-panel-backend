import axios from "axios";

const EKART_AUTH_URL = process.env.EKART_AUTH_URL;
const MERCHANT_CODE = process.env.MERCHANT_CODE;
const BASIC_AUTH = process.env.BASIC_AUTH;

let cachedToken = null;
let tokenExpiry = 0;

function parseTokenFromAuthResponse(res) {
  if (!res || !res.data) return null;
  const body = res.data;
  if (body.Authorization) return body.Authorization.split(" ")[1];
  if (body.authorization) return body.authorization.split(" ")[1];
  if (body.token) return body.token;
  if (res.headers && res.headers.authorization)
    return res.headers.authorization.split(" ")[1];
  return null;
}

export async function getAuthToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;

  try {
    const res = await axios.post(
      EKART_AUTH_URL,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          HTTP_X_MERCHANT_CODE: MERCHANT_CODE,
          Authorization: `Basic ${BASIC_AUTH}`,
        },
        timeout: 15000,
      }
    );

    const token = parseTokenFromAuthResponse(res);
    if (!token) throw new Error("Token missing in auth response");

    cachedToken = token;
    tokenExpiry = Date.now() + 55 * 60 * 1000; // Cache ~55 minutes
    return token;
  } catch (error) {
    const detail = error.response ? JSON.stringify(error.response.data) : error.message;
    throw new Error("Ekart Auth failed: " + detail);
  }
}
