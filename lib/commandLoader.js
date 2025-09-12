// lib/commandLoader.js
const fs = require("fs");
const path = require("path");

/**
 * يحمّل الأوامر تلقائيًا من مجلد commands/ (إن وجد).
 * ويدعم أكثر من شكل تصدير:
 * 1) module.exports = { name: "!hi", aliases: ["!Hi"], run: async (ctx) => {} }
 * 2) module.exports = async function(ctx) {}
 * 3) exports.run = async (ctx) => {}, exports.name = "!hi"
 */
function normalizeCommand(moduleExport, fileBase, logger) {
  // شكل (2): دالة مباشرة
  if (typeof moduleExport === "function") {
    return {
      name: "!" + fileBase, // اسم افتراضي من اسم الملف
      aliases: [fileBase],  // بدون !
      run: moduleExport,
    };
  }

  // شكل (3): exports.run + exports.name/aliases
  if (moduleExport && typeof moduleExport.run === "function") {
    const name = moduleExport.name || "!" + fileBase;
    const aliases = moduleExport.aliases || [fileBase];
    return { name, aliases, run: moduleExport.run };
  }

  // شكل (1): كائن فيه name/run
  if (moduleExport && typeof moduleExport.run === "function" && moduleExport.name) {
    return {
      name: moduleExport.name,
      aliases: moduleExport.aliases || [],
      run: moduleExport.run,
    };
  }

  logger && logger.warn(`⚠️ Invalid command shape in "${fileBase}.js" (no run/name).`);
  return null;
}

/**
 * يسجّل الأمر تحت شكلين: بالبادئة وبدونها ( !hi و hi )
 */
function registerNames(map, cmdObj) {
  const names = new Set();

  const pushName = (n) => {
    if (!n) return;
    const low = n.toLowerCase();
    names.add(low);
    // إن كان يبدأ بـ ! سجل النسخة بدون !
    if (low.startsWith("!")) names.add(low.slice(1));
    else names.add("!" + low);
  };

  pushName(cmdObj.name);
  (cmdObj.aliases || []).forEach(pushName);

  names.forEach((n) => map.set(n, cmdObj));
}

function loadCommands(logger) {
  const commandsDir = path.join(__dirname, "..", "commands");
  const commands = new Map();

  if (!fs.existsSync(commandsDir)) {
    logger && logger.warn("⚠️ commands/ directory not found. Skipping command autoload.");
    return commands;
  }

  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const full = path.join(commandsDir, file);
    const base = path.basename(file, ".js");
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(full);
      const cmd = normalizeCommand(mod, base, logger);
      if (!cmd) continue;

      registerNames(commands, cmd);
      logger && logger.info(`✅ Loaded command: ${cmd.name} (${file})`);
    } catch (err) {
      logger && logger.error({ err }, `❌ Failed to load command: ${file}`);
    }
  }

  return commands;
}

module.exports = { loadCommands };
