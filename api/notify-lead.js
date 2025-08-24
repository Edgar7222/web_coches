// 🔒 Versión mejorada con seguridad y validación

const rateLimitStore = new Map();

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, level: level.toUpperCase(), message, ...data };
  console.log(JSON.stringify(logEntry));
}

function validateInput(data) {
  const errors = [];
  
  if (!data.nombre || typeof data.nombre !== 'string') {
    errors.push('Nombre es requerido');
  } else {
    const nombre = data.nombre.trim();
    if (nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres');
    if (nombre.length > 100) errors.push('Nombre muy largo (máx. 100 caracteres)');
  }
  
  if (!data.email || typeof data.email !== 'string') {
    errors.push('Email es requerido');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const email = data.email.trim().toLowerCase();
    if (!emailRegex.test(email)) errors.push('Formato de email inválido');
    if (email.length > 254) errors.push('Email muy largo');
  }
  
  if (data.telefono && typeof data.telefono === 'string') {
    const phone = data.telefono.replace(/\D/g, '');
    if (phone.length > 0 && (phone.length < 9 || phone.length > 15)) {
      errors.push('Teléfono debe tener entre 9 y 15 dígitos');
    }
  }
  
  if (!data.mensaje || typeof data.mensaje !== 'string') {
    errors.push('Mensaje es requerido');
  } else {
    const mensaje = data.mensaje.trim();
    if (mensaje.length < 10) errors.push('Mensaje debe tener al menos 10 caracteres');
    if (mensaje.length > 2000) errors.push('Mensaje muy largo (máx. 2000 caracteres)');
  }
  
  return errors;
}

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutos
  const maxRequests = 5;
  
  const userRequests = rateLimitStore.get(ip) || [];
  const validRequests = userRequests.filter(time => now - time < windowMs);
  
  if (validRequests.length >= maxRequests) return false;
  
  validRequests.push(now);
  rateLimitStore.set(ip, validRequests);
  return true;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    const maxSize = 10 * 1024;
    let currentSize = 0;
    
    req.on('data', chunk => {
      currentSize += chunk.length;
      if (currentSize > maxSize) {
        reject(new Error('Payload demasiado grande'));
        return;
      }
      data += chunk;
    });
    
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (error) {
        reject(new Error('JSON inválido'));
      }
    });
    
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const startTime = Date.now();
  
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }
    
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     req.connection.remoteAddress || 'unknown';
    
    log('info', 'Lead submission started', { method: req.method, ip: clientIP });
    
    if (!checkRateLimit(clientIP)) {
      log('warning', 'Rate limit exceeded', { ip: clientIP });
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta en 15 minutos.' });
    }
    
    const body = await readBody(req);
    const validationErrors = validateInput(body);
    
    if (validationErrors.length > 0) {
      log('warning', 'Validation failed', { errors: validationErrors, ip: clientIP });
      return res.status(400).json({ error: 'Datos inválidos', details: validationErrors });
    }
    
    const cleanData = {
      nombre: (body.nombre || '').toString().trim(),
      email: (body.email || '').toString().trim().toLowerCase(),
      telefono: (body.telefono || '').toString().trim() || null,
      mensaje: (body.mensaje || '').toString().trim(),
      coche_interes: (body.coche_interes || '').toString().trim() || null,
      page_url: (body.page_url || '').toString().slice(0, 500),
      user_agent: (body.user_agent || '').toString().slice(0, 500)
    };
    
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const TO = process.env.LEADS_TO_EMAIL;
    const FROM = process.env.LEADS_FROM_EMAIL || 'Leads <onboarding@resend.dev>';
    
    if (!RESEND_API_KEY || !TO) {
      log('error', 'Missing environment variables');
      return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px;">🚗 Nuevo lead</h2>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Nombre:</strong> ${escapeHtml(cleanData.nombre)}</p>
          <p><strong>Email:</strong> ${escapeHtml(cleanData.email)}</p>
          ${cleanData.telefono ? `<p><strong>Teléfono:</strong> ${escapeHtml(cleanData.telefono)}</p>` : ''}
          ${cleanData.coche_interes ? `<p><strong>Coche:</strong> ${escapeHtml(cleanData.coche_interes)}</p>` : ''}
        </div>
        <div style="background: #fff; padding: 20px; border-left: 4px solid #667eea;">
          <p><strong>Mensaje:</strong></p>
          <p style="white-space: pre-wrap;">${escapeHtml(cleanData.mensaje)}</p>
        </div>
        <div style="border-top: 1px solid #e2e8f0; padding-top: 15px; color: #64748b; font-size: 0.9rem;">
          <p>📄 ${escapeHtml(cleanData.page_url)}</p>
          <p>🕒 ${new Date().toLocaleString('es-ES')}</p>
        </div>
      </div>
    `;
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `🚗 Nuevo lead: ${cleanData.nombre}${cleanData.coche_interes ? ` - ${cleanData.coche_interes}` : ''}`,
        html
      })
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
      throw new Error(`Resend API error: ${responseData?.message || 'Unknown error'}`);
    }
    
    const duration = Date.now() - startTime;
    log('info', 'Lead processed successfully', { duration: `${duration}ms`, emailId: responseData?.id });
    
    return res.status(200).json({ success: true, id: responseData?.id || null });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    log('error', 'Lead processing failed', { duration: `${duration}ms`, error: error.message });
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
