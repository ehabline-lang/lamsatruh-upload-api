import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

function safeFileName(name = "image.jpg") {
  const ext = name.split(".").pop()?.toLowerCase() || "jpg";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`;
}

function parseForm(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: 8 * 1024 * 1024,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { files } = await parseForm(req);

console.log("FILES =", Object.keys(files));

const firstKey = Object.keys(files)[0];
const fileValue = firstKey ? files[firstKey] : null;
const uploaded = Array.isArray(fileValue) ? fileValue[0] : fileValue;

if (!uploaded) {
  return res.status(400).json({ success: false, message: "No file provided" });
}

    if (!uploaded) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }

    const buffer = fs.readFileSync(uploaded.filepath);

    const storageEndpoint = process.env.BUNNY_STORAGE_ENDPOINT?.trim().replace(/\/$/, "");
    const apiKey = process.env.BUNNY_API_KEY?.trim();
    const cdnUrl = process.env.BUNNY_CDN_URL?.trim();

    if (!storageEndpoint || !apiKey || !cdnUrl) {
      return res.status(500).json({ success: false, message: "Missing Bunny environment variables" });
    }

    const path = safeFileName(uploaded.originalFilename || "image.jpg");
    const uploadUrl = `${storageEndpoint}/${path}`;

    const bunnyResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        AccessKey: apiKey,
        "Content-Type": uploaded.mimetype || "application/octet-stream",
      },
      body: buffer,
    });

    if (!bunnyResponse.ok) {
      const errorText = await bunnyResponse.text();
      return res.status(500).json({
        success: false,
        message: "Bunny upload failed",
        details: errorText,
      });
    }

    return res.status(200).json({
      success: true,
      url: `${cdnUrl.replace(/\/$/, "")}/${path}`,
      path,
    });
  } catch (error) {
    console.error("UPLOAD ERROR =", error);
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
    });
  }
}
