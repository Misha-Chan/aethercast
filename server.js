// ============================================================
//  aethercast — سيرفر مستقل يخدّم فقط صفحتي الفيديو والشورتس
//  كل منطق المصادقة/قاعدة البيانات يبقى على السيرفر الرئيسي (hostaka.fun)؛
//  هذا السيرفر واجهة + بروكسي شفاف لـ /api/* تجاهه.
// ============================================================
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();

// النطاق الرئيسي لهوستاكا (وين تعيش فعلياً كل الـ API + قاعدة البيانات)
const HOSTAKA_API_BASE = process.env.HOSTAKA_API_BASE || 'https://hostaka.fun';

app.disable('x-powered-by');
app.set('trust proxy', true);

// ============================================================
// بروكسي /api/* — نفس أسلوب orbithub بالضبط
// ============================================================
app.use('/api', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const targetUrl = HOSTAKA_API_BASE + '/api' + req.url;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (['host', 'connection', 'content-length', 'accept-encoding'].includes(key.toLowerCase())) continue;
      headers[key] = value;
    }

    const hasBody = req.body && Buffer.isBuffer(req.body) && req.body.length > 0;
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual'
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const buf = await upstream.buffer();
    res.send(buf);
  } catch (e) {
    console.error('❌ aethercast proxy error:', e);
    res.status(502).json({ error: 'تعذر الاتصال بخادم هوستاكا الرئيسي' });
  }
});

// ============================================================
// ملفات ثابتة (video.html/js/css، short.html/js/css، الحزم المشتركة...)
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// وسوم Open Graph — لما حد يشارك رابط فيديو/شورت، نحقن عنوان ووصف
// وصورة/رابط فيديو صحيحة بـ <head> قبل ما نرسل الصفحة، عشان بوتات
// واتساب/تويتر/ديسكورد (اللي ما تنفّذ جافاسكريبت) تشوف معاينة صحيحة.
// ============================================================
const SITE_NAME    = 'aethercast';
const DEFAULT_DESC = 'aethercast — منصة الفيديو والريلز من هوستاكا.';
const DEFAULT_IMG  = '/aethercast-light.png';

function ogEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ogTruncate(str, len = 160) {
  const s = String(str || '').replace(/<[^>]*>/g, '').trim();
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}
function absUrl(req, p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p; // أصلاً رابط مطلق (Cloudinary/imgbb غالباً)
  // مسار نسبي: يعني مستضاف على السيرفر الرئيسي، مو على aethercast
  return HOSTAKA_API_BASE + (p.startsWith('/') ? p : '/' + p);
}

function injectOG(html, meta) {
  const title = ogEscape(meta.title || SITE_NAME);
  const desc  = ogEscape(meta.description || DEFAULT_DESC);
  const image = meta.image ? ogEscape(meta.image) : ogEscape(absUrl({ }, DEFAULT_IMG));
  const url   = ogEscape(meta.url || '');
  const type  = meta.type || 'website';
  const robots = meta.robots || 'index, follow';

  let tags = `<meta name="robots" content="${robots}">\n`;
  tags += `  <meta property="og:site_name" content="${SITE_NAME}">\n`;
  tags += `  <meta property="og:title" content="${title}">\n`;
  tags += `  <meta property="og:description" content="${desc}">\n`;
  tags += `  <meta property="og:image" content="${image}">\n`;
  tags += `  <meta property="og:type" content="${type}">\n`;
  if (url) tags += `  <meta property="og:url" content="${url}">\n`;
  if (meta.video) {
    tags += `  <meta property="og:video" content="${ogEscape(meta.video)}">\n`;
    tags += `  <meta property="og:video:secure_url" content="${ogEscape(meta.video)}">\n`;
    tags += `  <meta property="og:video:type" content="video/mp4">\n`;
    tags += `  <meta name="twitter:card" content="player">\n`;
  } else {
    tags += `  <meta name="twitter:card" content="summary_large_image">\n`;
  }
  tags += `  <meta name="twitter:title" content="${title}">\n`;
  tags += `  <meta name="twitter:description" content="${desc}">\n`;
  tags += `  <meta name="twitter:image" content="${image}">\n`;

  if (/<title>[\s\S]*?<\/title>/.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>\n  ${tags}`);
  }
  return html.replace('</head>', `  ${tags}</head>`);
}

function requestUrl(req) {
  return `https://${req.get('host')}${req.originalUrl}`;
}

async function fetchRecordMeta(req, res, fileName, kind) {
  const meta = {
    title: SITE_NAME,
    description: DEFAULT_DESC,
    image: absUrl(req, DEFAULT_IMG),
    url: requestUrl(req),
    type: 'video.other'
  };

  const id = (req.query.id || '').trim();
  if (id) {
    try {
      const r = await fetch(`${HOSTAKA_API_BASE}/api/records/${encodeURIComponent(id)}/single`);
      if (r.ok) {
        const rec = await r.json();
        if (rec && !rec.error) {
          const who = rec.publisher_name || rec.publisher;
          meta.title = `${who} على ${SITE_NAME}`;
          meta.description = ogTruncate(rec.content) || DEFAULT_DESC;
          if (rec.image) meta.image = absUrl(req, rec.image);
          if (rec.video) meta.video = absUrl(req, rec.video);
        }
      }
    } catch (e) {
      console.error(`⚠️ aethercast OG lookup failed for ${kind} id=${id}:`, e.message);
      // نستمر بالميتاداتا الافتراضية عند أي خطأ — لا نكسر الصفحة بسبب هذا
    }
  }

  const fs = require('fs');
  const html = fs.readFileSync(path.join(__dirname, 'public', fileName), 'utf-8');
  res.set('Content-Type', 'text/html; charset=utf-8').send(injectOG(html, meta));
}

app.get('/',      (req, res) => res.redirect('/video'));
app.get('/video', (req, res) => fetchRecordMeta(req, res, 'video.html', 'video'));
app.get('/short', (req, res) => fetchRecordMeta(req, res, 'short.html', 'short'));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

// أي مسار غير معروف يرجع لفيد الفيديو (بدل 404 فاضي)
app.use((req, res) => res.redirect('/video'));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ aethercast server running on port ${PORT} (proxying /api to ${HOSTAKA_API_BASE})`));
}

module.exports = app;
