// ============================================================
//  aethercast — الخدمة متوقفة.
//  لم تعد هناك واجهة فيديو/ريلز هنا. هذا السيرفر يعيد صفحة إنجليزية
//  واحدة توضح أن الخدمة توقفت، وأن الريلز والفيديوهات انتقلت إلى
//  hostaka.fun. كل المسارات ترجع 410 Gone (لإزالة الصفحات القديمة
//  من نتائج البحث تدريجياً).
// ============================================================
const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// رؤوس أمان أساسية على كل الردود.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
  );
  next();
});

// محركات البحث: لا فهرسة لهذا النطاق بعد الإيقاف.
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// أي مسار آخر → صفحة الإيقاف بحالة 410 Gone.
const NOTICE = path.join(__dirname, 'public', 'index.html');
app.use((req, res) => res.status(410).sendFile(NOTICE));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`aethercast is discontinued — notice page on port ${PORT}`));
}

module.exports = app;
