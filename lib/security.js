const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function configuration(env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || !env.FIREBASE_API_KEY?.trim()) throw new HttpError(503, 'خدمة الرفع تحتاج إكمال إعداد Firebase');
  const endpoint = secureUrl(env.BUNNY_STORAGE_ENDPOINT);
  const cdn = secureUrl(env.BUNNY_CDN_URL);
  if (!env.BUNNY_API_KEY?.trim()) throw new HttpError(503, 'خدمة الصور غير مهيأة');
  const origins = new Set(['https://lamsatruh.com', 'https://www.lamsatruh.com']);
  for (const origin of String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)) {
    let parsed; try { parsed = new URL(origin); } catch { throw new HttpError(503, 'إعداد رابط الموقع غير صحيح'); }
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) throw new HttpError(503, 'إعداد رابط الموقع غير صحيح');
    origins.add(origin);
  }
  return { projectId, endpoint, cdn, origins, apiKey: env.FIREBASE_API_KEY.trim(), bunnyKey: env.BUNNY_API_KEY.trim() };
}

function secureUrl(value) {
  let url; try { url = new URL(String(value || '').trim()); } catch { throw new HttpError(503, 'إعداد خدمة الصور غير صحيح'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new HttpError(503, 'إعداد خدمة الصور غير صحيح');
  return url.href.replace(/\/$/, '');
}

async function verifyToken(token, config) {
  const name = 'lamsat-upload-' + config.projectId;
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId: config.projectId }, name);
  return getAuth(app).verifyIdToken(token);
}

function uploadPermission(profile) {
  return profile.active === true && (['admin', 'manager', 'products'].includes(profile.role) || (Array.isArray(profile.permissions) && profile.permissions.includes('media.upload')));
}

async function timedFetch(fetcher, url, options) {
  return fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
}

async function authorize(req, config, { verify = verifyToken, fetcher = fetch } = {}) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || header.length > 16384 || !/^Bearer [^\s]+$/i.test(header)) throw new HttpError(401, 'سجل الدخول قبل رفع الصور');
  const token = header.slice(7);
  let claims;
  try { claims = await verify(token, config); } catch { throw new HttpError(401, 'انتهت جلسة الدخول أو رمز الدخول غير صحيح'); }
  if (!claims.uid || claims.email_verified !== true || claims.firebase?.sign_in_second_factor !== 'totp') throw new HttpError(403, 'الرفع يحتاج بريداً موثقاً ودخولاً برمز Google Authenticator');

  // This authenticated lookup also checks the current Auth account, not only JWT expiry.
  const lookup = await timedFetch(fetcher, 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(config.apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  if (!lookup.ok) throw new HttpError(401, 'تعذر التحقق من جلسة الدخول');
  const identity = (await lookup.json()).users?.[0];
  if (!identity || identity.localId !== claims.uid || identity.disabled === true || identity.emailVerified !== true) throw new HttpError(403, 'الحساب غير مخول للرفع');
  if (identity.validSince && Number(claims.auth_time) < Number(identity.validSince)) throw new HttpError(401, 'سجل الدخول من جديد');
  const response = await timedFetch(fetcher, `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/users/${encodeURIComponent(claims.uid)}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!response.ok) throw new HttpError(response.status === 404 || response.status === 403 ? 403 : 503, 'تعذر التحقق من صلاحية رفع الصور');
  const fields = (await response.json()).fields || {};
  const profile = { active: fields.active?.booleanValue, role: fields.role?.stringValue, permissions: fields.permissions?.arrayValue?.values?.map(item => item.stringValue) || [] };
  if (!uploadPermission(profile)) throw new HttpError(403, 'الحساب معطل أو لا يملك صلاحية رفع الصور');
  return claims.uid;
}

function createLimiter({ now = Date.now, maxUsers = 1000 } = {}) {
  const users = new Map();
  return uid => {
    const time = now();
    for (const [id, state] of users) if (time - state.start >= 60000) users.delete(id);
    const state = users.get(uid);
    if (!state) {
      if (users.size >= maxUsers) return false;
      users.set(uid, { count: 1, start: time }); return true;
    }
    if (state.count >= 5) return false;
    state.count++; return true;
  };
}

module.exports = { HttpError, configuration, authorize, verifyToken, uploadPermission, createLimiter, timedFetch };
