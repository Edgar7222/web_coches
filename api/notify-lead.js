// api/notify-lead.js
// Inserta el lead en Supabase desde servidor + envía email con Resend
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, LEADS_TO_EMAIL, LEADS_FROM_EMAIL, ALLOWED_ORIGIN } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Rate limit muy simple en memoria (mejor usar Upstash/DB)
const rate = new Map();
function allow(ip) {
  const now = Date.now();
  const win = 15 * 60 * 1000; // 15 min
  const max = 5;
  const list = rate.get(ip) || [];
  const clean = list.filter(t => now - t < win);
  if (clean.length >= max) return false;
  clean.push(now); rate.set(ip, clean); return true;
}

function escapeHtml(s='') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function validate(payload) {
  const errs = [];
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!payload?.nombre || payload.nombre.trim().length < 2) errs.push('Nombre inválido');
  if (!payload?.email || !emailRx.test(payload.email)) errs.push('Email inválido');
  if (!payload?.mensaje || payload.mensaje.trim().length < 10) errs.push('Mensaje demasiado corto');
  if (payload.telefono) {
    const d = payload.telefono.replace(/\D/g,'');
    if (d.length && (d.length < 9 || d.length > 15)) errs.push('Teléfono inválido');
  }
  return errs;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  if (!allow(ip)) return res.status(429).json({ error: 'Too many requests' });

  const body = req.body ?? {};
  const errors = validate(body);
  if (errors.length) return res.status(400).json({ error: 'Bad request', details: errors });

  const toInsert = {
    nombre: body.nombre.trim(),
    email: body.email.trim().toLowerCase(),
    telefono: body.telefono?.toString().trim() || null,
    mensaje: body.mensaje.trim(),
    coche_interes: body.coche_interes?.toString().trim() || null,
    page_url: body.page_url?.toString().slice(0,500) || null,
    user_agent: body.user_agent?.toString().slice(0,500) || null,
    ip
  };

  // DB
  const { data, error } = await supabase.from('leads').insert([toInsert]).select().single();
  if (error) return res.status(500).json({ error: 'DB insert failed' });

  // Email (opcional)
  if (!RESEND_API_KEY || !LEADS_TO_EMAIL) return res.status(200).json({ ok: true, id: data?.id, warn: 'Email disabled' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#111">🚗 Nuevo lead</h2>
      <p><b>Nombre:</b> ${escapeHtml(toInsert.nombre)}</p>
      <p><b>Email:</b> ${escapeHtml(toInsert.email)}</p>
      ${toInsert.telefono ? `<p><b>Teléfono:</b> ${escapeHtml(toInsert.telefono)}</p>`: ''}
      ${toInsert.coche_interes ? `<p><b>Coche:</b> ${escapeHtml(toInsert.coche_interes)}</p>`: ''}
      <p style="white-space:pre-wrap"><b>Mensaje:</b>\n${escapeHtml(toInsert.mensaje)}</p>
      <hr>
      <small>📄 ${escapeHtml(toInsert.page_url || '')}<br/>IP: ${escapeHtml(ip)}</small>
    </div>
  `;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({
      from: LEADS_FROM_EMAIL || 'Leads <onboarding@resend.dev>',
      to: [LEADS_TO_EMAIL],
      subject: `🚗 Lead: ${toInsert.nombre}${toInsert.coche_interes ? ` - ${toInsert.coche_interes}` : ''}`,
      html
    })
  });
  const j = await r.json();
  if (!r.ok) return res.status(502).json({ error: 'Email failed', details: j });

  return res.status(200).json({ ok: true, id: data?.id, emailId: j?.id || null });
}
