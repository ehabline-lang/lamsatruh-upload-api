const formidable = require("formidable");
const fs = require("fs");

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function safeFileName(name = "image.jpg") {
  const ext = name.split(".").pop()?.toLowerCase() || "jpg";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`;
}

function createForm() {
  if (typeof formidable === "function") {
    return formidable({
      multiples: false,
      maxFileSize: 8 * 1024 * 1024,
    });
  }

  if (formidable.default) {
    return formidable.default({
      multiples: false,
      maxFileSize: 8 * 1024 * 1024,
    });
  }

  return new formidable.IncomingForm({
    multiples: false,
    maxFileSize: 8 * 1024 * 1024,
  });
}

function parseForm(req) {
  const form = createForm();

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed ehab",
      version: "commonjs-v1",
    });
  }

  try {
  const result = await parseForm(req);

  return res.status(200).json({
    success: true,
    version: "debug-final",
    result
  });
} catch (error) {
  return res.status(500).json({
    success: false,
    error: error.message
  });
}

    if (!uploaded) {
      return res.status(400).json({
        success: false,
        message: "No file provided",
        fileKeys: Object.keys(files || {}),
        version: "commonjs-v1",
      });
    }

    const buffer = fs.readFileSync(uploaded.filepath);

    const storageEndpoint = process.env.BUNNY_STORAGE_ENDPOINT?.trim().replace(/\/$/, "");
    const apiKey = process.env.BUNNY_API_KEY?.trim();
    const cdnUrl = process.env.BUNNY_CDN_URL?.trim();

    const path = safeFileName(uploaded.originalFilename || "image.jpg");

    const bunnyResponse = await fetch(`${storageEndpoint}/${path}`, {
      method: "PUT",
      headers: {
        AccessKey: apiKey,
        "Content-Type": uploaded.mimetype || "application/octet-stream",
      },
      body: buffer,
    });

    if (!bunnyResponse.ok) {
      return res.status(500).json({
        success: false,
        message: "Bunny upload failed",
        details: await bunnyResponse.text(),
      });
    }

    return res.status(200).json({
      success: true,
      url: `${cdnUrl.replace(/\/$/, "")}/${path}`,
      path,
      version: "commonjs-v1",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
    });
  }
}

module.exports = handler;
