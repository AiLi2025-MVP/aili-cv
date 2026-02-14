const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'inquiries.json');

const mailchimpConfig = {
  apiKey: process.env.MAILCHIMP_API_KEY,
  serverPrefix: process.env.MAILCHIMP_SERVER_PREFIX,
  listId: process.env.MAILCHIMP_LIST_ID
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = http.createServer(async (req, res) => {
  attachSecurityHeaders(res);

  if (req.url.startsWith('/api/') && req.method === 'OPTIONS') {
    return handleOptions(req, res);
  }

  if (req.method === 'POST' && req.url.startsWith('/api/inquiry')) {
    return handleInquiry(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(req, res, 405, { success: false, message: 'Method not allowed' });
  }

  return serveStatic(req, res);
});

function attachSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), magnetometer=()'
  );
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

function handleOptions(req, res) {
  applyCors(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.writeHead(204);
  res.end();
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = requestUrl.pathname;
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(req, res, 403, { success: false, message: 'Access denied' });
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = getContentType(ext);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheHeader(ext) });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      res.statusCode = 500;
      res.end('Server error');
    });
  });
}

function getContentType(ext) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
  };
  return map[ext] || 'application/octet-stream';
}

function cacheHeader(ext) {
  if (ext === '.html') {
    return 'no-cache';
  }
  return 'public, max-age=31536000, immutable';
}

function handleInquiry(req, res) {
  if (req.method !== 'POST') {
    return sendJson(req, res, 405, { success: false, message: 'Method not allowed' });
  }
  applyCors(req, res);

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e6) {
      req.socket.destroy();
    }
  });

  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const validationError = validatePayload(payload);
      if (validationError) {
        return sendJson(req, res, 400, { success: false, message: validationError });
      }

      if (payload.city) {
        return sendJson(req, res, 200, { success: true });
      }

      const inquiryRecord = {
        name: payload.name,
        email: payload.email,
        organization: payload.organization || '',
        phone: payload.phone || '',
        message: payload.message,
        receivedAt: new Date().toISOString()
      };

      if (isMailchimpConfigured()) {
        await relayToMailchimp(inquiryRecord);
        inquiryRecord.mailchimpSynced = true;
      } else {
        inquiryRecord.mailchimpSynced = false;
      }

      await persistInquiry(inquiryRecord);
      return sendJson(req, res, 200, { success: true });
    } catch (error) {
      console.error('Inquiry handling failed', error);
      return sendJson(req, res, 500, { success: false, message: 'Unable to process request right now.' });
    }
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid payload';
  }
  if (!payload.name || !payload.email || !payload.message) {
    return 'Name, email, and message are required.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return 'Please use a valid email address.';
  }
  return null;
}

function isMailchimpConfigured() {
  return Boolean(mailchimpConfig.apiKey && mailchimpConfig.serverPrefix && mailchimpConfig.listId);
}

async function relayToMailchimp(inquiry) {
  const subscriberHash = crypto
    .createHash('md5')
    .update(inquiry.email.toLowerCase())
    .digest('hex');

  const memberPayload = {
    email_address: inquiry.email,
    status_if_new: 'pending',
    merge_fields: {
      FNAME: inquiry.name || ''
    }
  };

  await mailchimpRequest(
    'PUT',
    `/3.0/lists/${mailchimpConfig.listId}/members/${subscriberHash}`,
    JSON.stringify(memberPayload)
  );

  const noteParts = [];
  if (inquiry.organization) noteParts.push(`Organization: ${inquiry.organization}`);
  if (inquiry.phone) noteParts.push(`Phone: ${inquiry.phone}`);
  if (inquiry.message) noteParts.push(`Message: ${inquiry.message}`);

  if (noteParts.length) {
    const notePayload = JSON.stringify({ note: noteParts.join('\n\n') });
    try {
      await mailchimpRequest(
        'POST',
        `/3.0/lists/${mailchimpConfig.listId}/members/${subscriberHash}/notes`,
        notePayload
      );
    } catch (error) {
      console.error('Failed to append Mailchimp note', error.message);
    }
  }
}

function mailchimpRequest(method, apiPath, payload) {
  const options = {
    hostname: `${mailchimpConfig.serverPrefix}.api.mailchimp.com`,
    port: 443,
    path: apiPath,
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `apikey ${mailchimpConfig.apiKey}`,
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseBody ? JSON.parse(responseBody) : {});
        } else {
          const errorMessage = extractMailchimpError(responseBody) || 'Mailchimp request failed';
          reject(new Error(errorMessage));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractMailchimpError(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed.detail || parsed.title;
  } catch (error) {
    return body;
  }
}

async function persistInquiry(entry) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  let existing = [];
  try {
    const file = await fs.promises.readFile(LOG_FILE, 'utf8');
    existing = JSON.parse(file);
    if (!Array.isArray(existing)) existing = [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read inquiry log', error);
    }
  }
  existing.push(entry);
  await fs.promises.writeFile(LOG_FILE, JSON.stringify(existing, null, 2));
}

function sendJson(req, res, statusCode, payload) {
  applyCors(req, res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
