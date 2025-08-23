// /api/notify-lead.js  (Vercel Serverless Function - Node.js)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = await readBody(req);
  const {
    nombre = '', email = '', telefono = '', mensaje = '',
    coche_interes = '', page_url = '', user_agent = ''
  } = body || {};

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const TO = process.env.LEADS_TO_EMAIL;     // Tu correo de recepción
  const FROM = process.env.LEADS_FROM_EMAIL || 'Leads <onboarding@resend.dev>';

  if (!RESEND_API_KEY || !TO) {
    return res.status(500).json({ error: 'Faltan variables de entorno (RESEND_API_KEY, LEADS_TO_EMAIL).' });
  }

  const html = `
    <h2>Nuevo lead en la web</h2>
    <p><b>Nombre:</b> ${esc(nombre)}</p>
    <p><b>Email:</b> ${esc(email)}</p>
    <p><b>Teléfono:</b> ${esc(telefono)}</p>
    <p><b>Coche de interés:</b> ${esc(coche_interes)}</p>
    <p><b>Mensaje:</b><br>${esc(mensaje).replace(/\n/g, '<br>')}</p>
    <hr>
    <p><b>Página:</b> ${esc(page_url)}</p>
    <p><b>User-Agent:</b> ${esc(user_agent)}</p>
  `;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `Nuevo lead: ${nombre} — ${coche_interes || 'Consulta'}`,
        html
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: data?.message || 'Error enviando email' });
    }

    return res.status(200).json({ ok: true, id: data?.id || null });
  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: 'Fallo en el envío de email' });
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
