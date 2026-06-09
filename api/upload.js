export const config = {
  api: {
    bodyParser: false,
  },
};

function safeFileName(name = "image") {
  const ext = name.split(".").pop()?.toLowerCase() || "jpg";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  console.log("METHOD =", req.method);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
  "Access-Control-Allow-Headers",
  "*"
);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const rawBody = await readRawBody(req);

    if (!rawBody || rawBody.length === 0) {
      return res.status(400).json({ success: false, message: "No file provided" });
    }

    const fileName = decodeURIComponent(req.headers["x-file-name"] || "image.jpg");
    const contentType = req.headers["x-content-type"] || req.headers["content-type"] || "application/octet-stream";

    const storageEndpoint = process.env.BUNNY_STORAGE_ENDPOINT?.trim().replace(/\/$/, "");
    const apiKey = process.env.BUNNY_API_KEY?.trim();
    const cdnUrl = process.env.BUNNY_CDN_URL?.trim();

    console.log("ENDPOINT =", storageEndpoint);
    console.log("APIKEY =", apiKey ? "FOUND" : "MISSING");
    console.log("CDN =", cdnUrl);
    console.log("FILE SIZE =", rawBody.length);

    if (!storageEndpoint || !apiKey || !cdnUrl) {
      return res.status(500).json({ success: false, message: "Missing Bunny environment variables" });
    }

    const path = safeFileName(fileName);
    const uploadUrl = `${storageEndpoint}/${path}`;

    const bunnyResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        AccessKey: apiKey,
        "Content-Type": contentType,
      },
      body: rawBody,
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
