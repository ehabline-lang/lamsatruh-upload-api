const { IncomingForm } = require("formidable");
const fs = require("fs");

module.exports.config = {
  api: { bodyParser: false },
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://lamsatruh.net");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeFileName(name = "image.jpg") {
  const ext = name.split(".").pop()?.toLowerCase() || "jpg";
  const cleanExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  return `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${cleanExt}`;
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const form = new IncomingForm({ multiples: false, keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    try {
      if (err) return res.status(500).json({ success: false, message: err.message });

      const fileValue = files.file;
      const file = Array.isArray(fileValue) ? fileValue[0] : fileValue;

      if (!file) {
        return res.status(400).json({ success: false, message: "No file provided" });
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
