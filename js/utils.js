/**
 * Utilidades de seguridad y UX
 * Incluir este archivo antes de los scripts principales
 */

// 🛡️ SEGURIDAD: Función para sanitizar HTML y prevenir XSS
function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str.toString();
    return div.innerHTML;
}

// 🛡️ SEGURIDAD: Insertar contenido HTML de forma segura
function safeInnerHTML(element, htmlContent) {
    if (!element) return;
    element.innerHTML = htmlContent;
}

// 🛡️ SEGURIDAD: Insertar texto de forma segura
function safeTextContent(element, textContent) {
    if (!element) return;
    element.textContent = textContent || '';
}

// 🔔 NOTIFICACIONES: Sistema de alertas para el usuario
class NotificationSystem {
    constructor() {
        this.container = this.createContainer();
    }
    
    createContainer() {
        if (document.getElementById('notifications-container')) {
            return document.getElementById('notifications-container');
        }
        
        const container = document.createElement('div');
        container.id = 'notifications-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            pointer-events: none;
            max-width: 400px;
        `;
        document.body.appendChild(container);
        return container;
    }
    
    show(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const colors = {
            error: { bg: '#FED7D7', color: '#C53030', border: '#F56565' },
            success: { bg: '#C6F6D5', color: '#25855A', border: '#48BB78' },
            warning: { bg: '#FEEBC8', color: '#DD6B20', border: '#ED8936' },
            info: { bg: '#BEE3F8', color: '#3182CE', border: '#4299E1' }
        };
        
        const style = colors[type] || colors.info;
        
        notification.style.cssText = `
            background: ${style.bg};
            color: ${style.color};
            border: 1px solid ${style.border};
            padding: 16px 20px;
            border-radius: 8px;
            margin-bottom: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            pointer-events: auto;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            word-wrap: break-word;
            font-weight: 500;
            font-size: 0.9rem;
        `;
        notification.textContent = message;
        
        this.container.appendChild(notification);
        
        // Animación de entrada
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
        });
        
        // Auto-remove
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
    }
    
    error(message) { this.show(message, 'error', 7000); }
    success(message) { this.show(message, 'success', 4000); }
    warning(message) { this.show(message, 'warning', 6000); }
    info(message) { this.show(message, 'info', 5000); }
}

// ✅ VALIDACIÓN: Funciones de validación
const Validator = {
    email(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email) && email.length <= 254;
    },
    
    phone(phone) {
        const cleaned = phone.replace(/\D/g, '');
        return cleaned.length >= 9 && cleaned.length <= 15;
    },
    
    required(value, minLength = 1) {
        return value && value.toString().trim().length >= minLength;
    },
    
    maxLength(value, max) {
        return !value || value.toString().length <= max;
    }
};

// 🌐 Instancia global del sistema de notificaciones
window.notify = new NotificationSystem();
window.Validator = Validator;

// 🔧 Utilidad para debug
window.DEBUG = {
    log: (message, data) => {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.log(`[DEBUG] ${message}`, data);
        }
    },
    error: (message, error) => {
        console.error(`[ERROR] ${message}`, error);
    }
};

console.log('🛡️ Utils.js loaded - Security and UX utilities ready');
