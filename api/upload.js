export const config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
};

function safeFileName(name = "image") {
  const ext = name.split(".").pop()?.toLowerCase() || "jpg";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { file, fileName, contentType } = req.body || {};

    if (!file) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }

    const storageZone = process.env.BUNNY_STORAGE_ZONE;
const apiKey = process.env.BUNNY_API_KEY;
const cdnUrl = process.env.BUNNY_CDN_URL;

    if (!storageZone || !apiKey || !cdnUrl) {
      return res.status(500).json({ success: false, message: "Missing Bunny environment variables" });
    }

    const base64Data = String(file).replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const path = safeFileName(fileName);

    const uploadUrl = `https://storage.bunnycdn.com/${storageZone}/${path}`;

    const bunnyResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
  AccessKey: String(apiKey).trim(),
  "Content-Type": contentType || "application/octet-stream",
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
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
    });
  }
}
