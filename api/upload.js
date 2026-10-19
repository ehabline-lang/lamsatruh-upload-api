const { IncomingForm } = require('formidable');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { HttpError, configuration, authorize, createLimiter, timedFetch } = require('../lib/security');

const MAX_FILE = 4 * 1024 * 1024;
const MAX_BODY = MAX_FILE + 128 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
const limiter = createLimiter();

async function imageBytes(file) {
  const formats = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
  const extension = path.extname(file.originalFilename || '').slice(1).toLowerCase();
  if (!formats[file.mimetype]?.includes(extension)) throw new HttpError(400, 'اختر صورة JPG أو PNG أو WEBP أصلية');
  const input = await fs.readFile(file.filepath);
  if (!input.length || input.length > MAX_FILE) throw new HttpError(413, 'حجم الصورة يجب ألا يتجاوز 4 ميغابايت');
  try {
    const image = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'warning', animated: false });
    const meta = await image.metadata();
    const expected = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[file.mimetype];
    if (meta.format !== expected || !meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 || (meta.pages || 1) > 1) throw Error('invalid image');
    // Decode and re-encode; metadata and appended non-image content are not retained.
    return await image.rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  } catch { throw new HttpError(400, 'محتوى الصورة غير صالح أو أبعادها أكبر من المسموح'); }
}

function createHandler({ env = process.env, fetcher = fetch, verify, allow = limiter } = {}) {
  return async (req, res) => {
    let directory;
    let status = 200, payload;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    try {
      const config = configuration(env);
      const origin = req.headers.origin;
      if (origin && !config.origins.has(origin)) throw new HttpError(403, 'رابط الموقع غير مسموح');
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.status(204).end();
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); throw new HttpError(405, 'طريقة الطلب غير مسموحة'); }
      const uid = await authorize(req, config, { verify, fetcher });
      if (!allow(uid)) { res.setHeader('Retry-After', '60'); throw new HttpError(429, 'طلبات رفع كثيرة؛ انتظر دقيقة وأعد المحاولة'); }
      if (!/^multipart\/form-data;\s*boundary=/i.test(req.headers['content-type'] || '')) throw new HttpError(400, 'صيغة رفع الملف غير صحيحة');
      const length = req.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new HttpError(413, 'حجم طلب الرفع أكبر من المسموح');
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lamsat-upload-'));
      const form = new IncomingForm({ uploadDir: directory, multiples: false, keepExtensions: false, maxFiles: 1, maxFileSize: MAX_FILE, maxTotalFileSize: MAX_FILE, maxFields: 0, maxFieldsSize: 0, allowEmptyFiles: false, minFileSize: 1 });
      let fields, files;
      try { [fields, files] = await form.parse(req); }
      catch (error) { throw new HttpError(error.httpCode === 413 ? 413 : 400, 'تعذر قراءة الملف؛ ارفع صورة واحدة بحجم لا يتجاوز 4 ميغابايت'); }
      if (Object.keys(fields).length || Object.keys(files).length !== 1 || !Array.isArray(files.file) || files.file.length !== 1) throw new HttpError(400, 'ارفع صورة واحدة فقط في حقل file');
      const buffer = await imageBytes(files.file[0]);
      const storagePath = `products/${randomUUID()}.jpg`;
      const uploaded = await timedFetch(fetcher, `${config.endpoint}/${storagePath}`, {
        method: 'PUT', headers: { AccessKey: config.bunnyKey, 'Content-Type': 'image/jpeg' }, body: buffer,
      });
      if (!uploaded.ok) throw new HttpError(502, 'تعذر حفظ الصورة؛ حاول مرة ثانية');
      payload = { success: true, url: `${config.cdn}/${storagePath}`, path: storagePath };
    } catch (error) {
      status = error instanceof HttpError ? error.status : 503;
      payload = { success: false, message: error instanceof HttpError ? error.message : 'تعذر إكمال رفع الصورة؛ حاول لاحقاً' };
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 }).catch(() => console.warn('Upload temporary cleanup failed'));
    }
    return res.status(status).json(payload);
  };
}

const handler = createHandler();
// Assign after module.exports: the old file accidentally discarded this setting.
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.createHandler = createHandler;
module.exports.imageBytes = imageBytes;
