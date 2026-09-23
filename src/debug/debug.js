
const db = require('./../supabase/client');

async function genericLog(caller, message, type, color) {
    console.log(`[${type}] [${caller}] ${message}`);
    db.addLog(caller, message, type, color);
}

async function log(caller, message) {
    await genericLog(caller, message, "LOG", "#8B8B9E");
}

async function error(caller, message) {
    await genericLog(caller, message, "ERROR", "#E57373");
}
async function warn(caller, message) {
    await genericLog(caller, message, "WARN", "#E8B96D");
}
async function debug(caller, message) {
    await genericLog(caller, message, "DEBUG", "#A995D6");
}
async function success(caller, message) {
    await genericLog(caller, message, "SUCCESS", "#5CBF9B");
}
async function critical(caller, message) {
    await genericLog(caller, message, "CRITICAL", "#D94F70");
}
async function info(caller, message) {
    await genericLog(caller, message, "INFO", "#7C9CC6");
}

module.exports = {
    log,
    error,
    warn,
    debug,
    success,
    critical,
    info,
};
