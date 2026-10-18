
let db = null;

try {
    db = require('./../supabase/client');
} catch (err) {
    db = null;
}

const DEFAULT_COLORS = {
    LOG: '#8B8B9E',
    ERROR: '#E57373',
    WARN: '#E8B96D',
    DEBUG: '#A995D6',
    SUCCESS: '#5CBF9B',
    CRITICAL: '#D94F70',
    INFO: '#7C9CC6',
};

function normalizeLogValue(value, fallback = '') {
    if (value === null || value === undefined) {
        return fallback;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    try {
        const serialized = JSON.stringify(value);
        return serialized && serialized !== undefined ? serialized : fallback;
    } catch (err) {
        return fallback;
    }
}

async function genericLog(caller, message, type, color) {
    const normalizedCaller = normalizeLogValue(caller, 'unknown');
    const normalizedMessage = normalizeLogValue(message, '');
    const normalizedType = normalizeLogValue(type, 'LOG').toUpperCase();
    const resolvedColor = typeof color === 'string' && color.trim()
        ? color.trim()
        : DEFAULT_COLORS[normalizedType] || '#8B8B9E';

    console.log(`[${normalizedType}] [${normalizedCaller}] ${normalizedMessage}`);

    if (!db || typeof db.addLog !== 'function') {
        return null;
    }

    try {
        return await db.addLog(normalizedCaller, normalizedMessage, normalizedType, resolvedColor);
    } catch (err) {
        console.warn('[debug] Unable to persist log entry:', err?.message || err);
        return null;
    }
}

async function log(caller, message) {
    return genericLog(caller, message, 'LOG', DEFAULT_COLORS.LOG);
}

async function error(caller, message) {
    return genericLog(caller, message, 'ERROR', DEFAULT_COLORS.ERROR);
}

async function warn(caller, message) {
    return genericLog(caller, message, 'WARN', DEFAULT_COLORS.WARN);
}

async function debug(caller, message) {
    return genericLog(caller, message, 'DEBUG', DEFAULT_COLORS.DEBUG);
}

async function success(caller, message) {
    return genericLog(caller, message, 'SUCCESS', DEFAULT_COLORS.SUCCESS);
}

async function critical(caller, message) {
    return genericLog(caller, message, 'CRITICAL', DEFAULT_COLORS.CRITICAL);
}

async function info(caller, message) {
    return genericLog(caller, message, 'INFO', DEFAULT_COLORS.INFO);
}

module.exports = {
    genericLog,
    log,
    error,
    warn,
    debug,
    success,
    critical,
    info,
};
