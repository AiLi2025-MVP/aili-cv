const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

function normalizeOriginList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyCors(req, res) {
  const allowed = normalizeOriginList(process.env.ALLOWED_ORIGINS);
  const origin = req.headers.origin;
  if (!origin) return;

  if (allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

function attachSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), magnetometer=()'
  );
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid payload.';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';

  if (!name || !email || !message) return 'Name, email, and message are required.';
  if (!EMAIL_RE.test(email)) return 'Please use a valid email address.';
  if (message.length > 5000) return 'Message is too long.';
  return null;
}

function isMailchimpConfigured() {
  return Boolean(
    process.env.MAILCHIMP_API_KEY &&
      process.env.MAILCHIMP_SERVER_PREFIX &&
      process.env.MAILCHIMP_LIST_ID
  );
}

async function mailchimpRequest(method, path, payload) {
  const serverPrefix = process.env.MAILCHIMP_SERVER_PREFIX;
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!serverPrefix || !apiKey) {
    throw new Error('Mailchimp not configured.');
  }

  const url = `https://${serverPrefix}.api.mailchimp.com${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `apikey ${apiKey}`
    },
    body: payload
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.detail || data?.title || `Mailchimp request failed (${response.status}).`;
    throw new Error(message);
  }

  return data;
}

async function relayToMailchimp(inquiry) {
  const listId = process.env.MAILCHIMP_LIST_ID;
  const subscriberHash = crypto
    .createHash('md5')
    .update(inquiry.email.toLowerCase())
    .digest('hex');

  const memberPayload = {
    email_address: inquiry.email,
    status_if_new: 'pending',
    merge_fields: {
      FNAME: inquiry.name || '',
      PHONE: inquiry.phone || '',
      COMPANY: inquiry.organization || ''
    }
  };

  await mailchimpRequest(
    'PUT',
    `/3.0/lists/${listId}/members/${subscriberHash}`,
    JSON.stringify(memberPayload)
  );

  const noteParts = [];
  if (inquiry.organization) noteParts.push(`Organization: ${inquiry.organization}`);
  if (inquiry.phone) noteParts.push(`Phone: ${inquiry.phone}`);
  if (inquiry.message) noteParts.push(`Message: ${inquiry.message}`);

  if (noteParts.length) {
    try {
      await mailchimpRequest(
        'POST',
        `/3.0/lists/${listId}/members/${subscriberHash}/notes`,
        JSON.stringify({ note: noteParts.join('\n\n') })
      );
    } catch (error) {
      // notes are helpful but non-critical
    }
  }
}

async function relayToWebhook(inquiry) {
  const url = process.env.INQUIRY_WEBHOOK_URL;
  if (!url) return;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inquiry)
  });
}

module.exports = async function handler(req, res) {
  attachSecurityHeaders(res);
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return json(res, 405, { success: false, message: 'Method not allowed' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
  } catch (error) {
    return json(res, 400, { success: false, message: 'Invalid JSON.' });
  }

  const city = typeof payload.city === 'string' ? payload.city.trim() : '';
  if (city) {
    return json(res, 200, { success: true });
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    return json(res, 400, { success: false, message: validationError });
  }

  const inquiry = {
    name: payload.name.trim(),
    email: payload.email.trim(),
    organization: typeof payload.organization === 'string' ? payload.organization.trim() : '',
    phone: typeof payload.phone === 'string' ? payload.phone.trim() : '',
    message: payload.message.trim(),
    receivedAt: new Date().toISOString()
  };

  try {
    if (isMailchimpConfigured()) {
      await relayToMailchimp(inquiry);
    }

    await relayToWebhook(inquiry);

    return json(res, 200, { success: true });
  } catch (error) {
    return json(res, 500, {
      success: false,
      message: error?.message || 'Unable to process request right now.'
    });
  }
};
