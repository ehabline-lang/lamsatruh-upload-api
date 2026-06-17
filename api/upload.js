const { IncomingForm } = require("formidable");
const fs = require("fs");
const rateLimit = new Map();

module.exports.config = {
  api: { bodyParser: false },
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://lamsatruh.net");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function safeFileName(name = "image.jpg") {
  const ext = name.split(".").pop()?.toLowerCase() || "jpg";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`;
}

async function verifyFirebaseToken(req) {
  const authHeader = req.headers.authorization || "";

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "")
    : null;

  if (!token) {
    return {
      ok: false,
      status: 401,
      message: "No auth token provided",
    };
  }

  if (!process.env.FIREBASE_API_KEY || !process.env.ADMIN_EMAIL) {
    return {
      ok: false,
      status: 500,
      message: "Missing Firebase API environment variables",
    };
  }

  const verifyResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    }
  );

  const verifyData = await verifyResponse.json();

  if (!verifyResponse.ok || !verifyData.users?.length) {
    return {
      ok: false,
      status: 401,
      message: "Invalid Firebase token",
    };
  }

  const firebaseUser = verifyData.users[0];

  if (
    String(firebaseUser.email || "").toLowerCase() !==
    String(process.env.ADMIN_EMAIL || "").toLowerCase()
  ) {
    return {
      ok: false,
      status: 403,
      message: "This user is not allowed to upload",
    };
  }

  return {
    ok: true,
    user: firebaseUser,
  };
}

function checkRateLimit(userId) {
  const now = Date.now();

  const windowMs = 60 * 1000; // دقيقة
  const maxRequests = 5;

  let data = rateLimit.get(userId);

  if (!data) {
    data = {
      count: 1,
      start: now,
    };

    rateLimit.set(userId, data);
    return true;
  }

  if (now - data.start > windowMs) {
    data.count = 1;
    data.start = now;

    rateLimit.set(userId, data);
    return true;
  }

  if (data.count >= maxRequests) {
    return false;
  }

  data.count++;

  rateLimit.set(userId, data);

  return true;
}



module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const authCheck = await verifyFirebaseToken(req);

  if (!authCheck.ok) {
    return res.status(authCheck.status).json({
      success: false,
      message: authCheck.message,
    });
  }
const userId = authCheck.user.localId || authCheck.user.email || "unknown";

if (!checkRateLimit(userId)) {
  return res.status(429).json({
    success: false,
    message: "Too many upload requests. Please try again later.",
  });
}
  const form = new IncomingForm({
    multiples: false,
    keepExtensions: true,
    maxFileSize: 5 * 1024 * 1024,
  });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) {
        return res.status(500).json({ success: false, message: err.message });
      }

      const fileValue = files.file;
      const file = Array.isArray(fileValue) ? fileValue[0] : fileValue;

      if (!file) {
        return res.status(400).json({ success: false, message: "No file provided" });
      }

      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "Only JPG, PNG, and WEBP images are allowed",
        });
      }

      const buffer = fs.readFileSync(file.filepath);

      const endpoint = process.env.BUNNY_STORAGE_ENDPOINT?.trim().replace(/\/$/, "");
      const key = process.env.BUNNY_API_KEY?.trim();
      const cdn = process.env.BUNNY_CDN_URL?.trim().replace(/\/$/, "");

      if (!endpoint || !key || !cdn) {
        return res.status(500).json({
          success: false,
          message: "Missing Bunny environment variables",
        });
      }

      const path = safeFileName(file.originalFilename || "image.jpg");

      const r = await fetch(`${endpoint}/${path}`, {
        method: "PUT",
        headers: {
          AccessKey: key,
          "Content-Type": file.mimetype || "application/octet-stream",
        },
        body: buffer,
      });

      if (!r.ok) {
        return res.status(500).json({
          success: false,
          message: "Bunny upload failed",
          details: await r.text(),
        });
      }

      return res.status(200).json({
        success: true,
        url: `${cdn}/${path}`,
        path,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Upload failed",
        error: error.message,
      });
    }
  });
};
