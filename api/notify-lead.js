// /api/notify-lead.js
import { createClient } from "@supabase/supabase-js";

// --- Rate limit simple por IP (memoria del runtime) ---
const hits = new Map();
function allow(ip, windowMs = 15 * 60 * 1000, max = 20) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

// --- Validaciones ---
function validate(body) {
  const errs = [];
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const nombre = (body?.nombre || "").trim();
  const email  = (body?.email  || "").trim().toLowerCase();
  const mensaje= (body?.mensaje|| "").trim();
  const telefono = (body?.telefono || "").toString();

  if (nombre.length < 2) errs.push("Nombre debe tener al menos 2 caracteres");
  if (!emailRx.test(email)) errs.push("Email inválido");
  if (mensaje.length < 10) errs.push("Mensaje mínimo 10 caracteres");
  if (telefono) {
    const digits = telefono.replace(/\D/g, "");
    if (digits.length < 9 || digits.length > 15) errs.push("Teléfono 9-15 dígitos");
  }
  return errs;
}

function escapeHtml(s=""){
  return String(s)
   .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
   .replace(/"/g,"&quot;").replace(/'/g,"&#x27;");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]
            || req.headers["x-real-ip"]
            || req.socket?.remoteAddress
            || "unknown";

    if (!allow(ip)) return res.status(429).json({ error: "Demasiadas solicitudes. Intenta en 15 minutos." });

    const body = typeof req.body === "object" && req.body
      ? req.body
      : await new Promise((resolve, reject) => {
          let raw = "";
          req.on("data", c => (raw += c));
          req.on("end", () => {
            try { resolve(JSON.parse(raw || "{}")); }
            catch { reject(new Error("JSON inválido")); }
          });
          req.on("error", reject);
        });

    const errors = validate(body);
    if (errors.length) return res.status(400).json({ error: "Datos inválidos", details: errors });

    // --- Inserción en Supabase con SERVICE ROLE ---
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE,
      { auth: { persistSession: false } }
    );

    const toInsert = {
      nombre: (body.nombre||"").trim(),
      email:  (body.email||"").trim().toLowerCase(),
      telefono: (body.telefono||null) || null,
      mensaje: (body.mensaje||"").trim(),
      coche_interes: (body.coche_interes||null) || null,
      car_id: (body.car_id||null) || null,
      page_url: (body.page_url||"").toString().slice(0,500),
      user_agent: (body.user_agent||"").toString().slice(0,500),
      ip,
      estado: "nuevo"
    };

    const { data, error } = await supabase
      .from("leads")
      .insert([toInsert])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "DB insert failed", details: error.message });
    }

    // --- Email (best-effort: no rompemos si falla) ---
    let emailSent = false;
    try {
      const FROM = process.env.LEADS_FROM_EMAIL || "Leads <onboarding@resend.dev>";
      const TO   = process.env.LEADS_TO_EMAIL;
      if (!process.env.RESEND_API_KEY || !TO) throw new Error("Resend config incompleta");

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2>🚗 Nuevo lead</h2>
          <p><b>Nombre:</b> ${escapeHtml(toInsert.nombre)}</p>
          <p><b>Email:</b> ${escapeHtml(toInsert.email)}</p>
          ${toInsert.telefono ? `<p><b>Teléfono:</b> ${escapeHtml(toInsert.telefono)}</p>` : ""}
          ${toInsert.coche_interes ? `<p><b>Coche:</b> ${escapeHtml(toInsert.coche_interes)}</p>` : ""}
          <p><b>Mensaje:</b></p>
          <pre style="white-space:pre-wrap">${escapeHtml(toInsert.mensaje)}</pre>
          <hr/>
          <small>📄 ${escapeHtml(toInsert.page_url)} | 🕒 ${new Date().toLocaleString("es-ES")}</small>
        </div>`;

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: FROM,
          to: [TO],
          subject: `Nuevo lead: ${toInsert.nombre}${toInsert.coche_interes ? " - " + toInsert.coche_interes : ""}`,
          html
        })
      });

      if (!r.ok) {
        const j = await r.json().catch(()=>null);
        console.warn("Resend error:", j || r.status);
      } else {
        emailSent = true;
      }
    } catch (e) {
      console.warn("Email not sent:", e.message);
    }

    return res.status(200).json({ success: true, id: data.id, emailSent });
  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
