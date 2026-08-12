// Renders the KeepsakeDrop printable table sign to PDF by driving a real
// headless Chromium against the live setup form on keepsakedrop-site/drop.html
// (the #print-sign element is only populated client-side after the host
// fills the setup form and clicks "Generate a Guest Link", so we replay
// exactly that flow rather than trying to fake the DOM state ourselves).
//
// POST /api/sign-pdf
// Headers: x-api-key: <SIGN_PDF_API_KEY>
// Body (JSON): {
//   eventName:  string (required)  e.g. "Tinlee Belle turns ONE"
//   eventType:  "wedding" | "graduation" | "event" (required)
//   hostName:   string (optional)  shown as the sign title if set
//   eventDate:  "YYYY-MM-DD" (optional)
//   theme:      "gold" | "blush" | "blue" | "sage" | "custom" (default "gold")
//   accentHex:  6 hex chars, no '#' (required if theme === "custom")
//   scriptUrl:  the guest-upload Apps Script /exec URL (required)
//   folderId:   the Drive album folder ID (required)
//   siteUrl:    override for the drop.html origin (default keepsakedrop.com)
// }
// Response: application/pdf bytes.

const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const REQUIRED_FIELDS = ['eventName', 'eventType', 'scriptUrl', 'folderId'];
const VALID_TYPES = ['wedding', 'graduation', 'event'];
const VALID_THEMES = ['gold', 'blush', 'blue', 'sage', 'custom'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const apiKey = req.headers['x-api-key'];
  if (!process.env.SIGN_PDF_API_KEY || apiKey !== process.env.SIGN_PDF_API_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) {
      res.status(400).json({ error: `missing required field: ${field}` });
      return;
    }
  }
  if (!VALID_TYPES.includes(body.eventType)) {
    res.status(400).json({ error: `eventType must be one of ${VALID_TYPES.join(', ')}` });
    return;
  }
  const theme = VALID_THEMES.includes(body.theme) ? body.theme : 'gold';
  if (theme === 'custom' && !/^[0-9a-fA-F]{6}$/.test(String(body.accentHex || ''))) {
    res.status(400).json({ error: 'accentHex must be 6 hex chars when theme is custom' });
    return;
  }

  const siteUrl = (body.siteUrl || 'https://keepsakedrop.com').replace(/\/$/, '');

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1000, height: 1200 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(`${siteUrl}/drop.html`, { waitUntil: 'networkidle0', timeout: 20000 });

    // Fill the setup form exactly as a host would, then click Generate —
    // this is what actually populates #print-sign and draws the QR code.
    await page.evaluate((p) => {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setVal('setup-event', p.eventName);
      setVal('setup-type', p.eventType);
      if (p.hostName) setVal('setup-name', p.hostName);
      if (p.eventDate) setVal('setup-date', p.eventDate);
      setVal('setup-theme', p.theme);
      if (p.theme === 'custom') setVal('setup-accent', '#' + p.accentHex.replace('#', ''));
      setVal('setup-script', p.scriptUrl);
      setVal('setup-folder', p.folderId);
    }, {
      eventName: body.eventName,
      eventType: body.eventType,
      hostName: body.hostName || '',
      eventDate: body.eventDate || '',
      theme,
      accentHex: body.accentHex || '',
      scriptUrl: body.scriptUrl,
      folderId: body.folderId,
    });

    await page.click('#btn-generate');

    // Wait for the QR canvas to actually render into the sign image —
    // proof the sign is fully populated, not just that the click fired.
    await page.waitForFunction(() => {
      const qr = document.getElementById('ps-qr');
      return !!(qr && qr.src && qr.src.indexOf('data:') === 0);
    }, { timeout: 10000 });

    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // honors the page's own @page { size: letter portrait; margin: 0.4in; }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="table-sign.pdf"');
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    console.error('sign-pdf error:', err);
    res.status(500).json({ error: String(err && err.message || err) });
  } finally {
    if (browser) await browser.close();
  }
};
