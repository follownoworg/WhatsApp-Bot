// handlers/messages.js
const { loadCommands } = require("../lib/commandLoader");
let commandsCache = null;

let keywordReplies = {};
try {
  keywordReplies = require("../config/keywords"); // اختياري: ردود بالكلمات
} catch (_) {
  keywordReplies = {};
}

/**
 * يسجّل مستمع الرسائل ويطبّق:
 * - أوامر من مجلد commands/ (لو موجود) مع وبدون "!"
 * - ردود كلمات مفتاحية من config/keywords.js (اختياري)
 * - أوامر مدمجة بسيطة كـ fallback
 */
module.exports = function registerMessageHandlers(sock, logger) {
  if (!commandsCache) {
    commandsCache = loadCommands(logger); // حمّل أوامر commands/ مرة واحدة
  }

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      if (!messages || !messages.length) return;
      const msg = messages[0];

      // تجاهل رسائل الحالة والرسائل من البوت نفسه
      if (msg.key?.remoteJid === "status@broadcast") return;
      if (msg.key?.fromMe) return;

      const chatId = msg.key.remoteJid;
      const isGroup = chatId?.endsWith("@g.us");
      const senderId = (msg.key?.participant || msg.key?.remoteJid || "").split(":")[0];

      // استخراج نص الرسالة
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        msg.message?.documentMessage?.caption ||
        msg.message?.buttonsResponseMessage?.selectedDisplayText ||
        msg.message?.templateButtonReplyMessage?.selectedDisplayText ||
        "";

      const text = (body || "").trim();
      if (!text) return;

      const reply = (t) => sock.sendMessage(chatId, { text: t }, { quoted: msg });

      // 1) كلمات مفتاحية (case-insensitive)
      const lower = text.toLowerCase();
      if (keywordReplies[lower]) {
        await reply(keywordReplies[lower]);
        return;
      }

      // 2) أوامر من مجلد commands/ (نقبل بالبادئة وبدونها)
      if (commandsCache && commandsCache.size > 0) {
        const [firstWord, ...args] = text.split(/\s+/);
        const key1 = firstWord.toLowerCase();           // كما هي
        const key2 = key1.startsWith("!") ? key1.slice(1) : "!" + key1; // معكوسة

        const mod = commandsCache.get(key1) || commandsCache.get(key2);
        if (mod && typeof mod.run === "function") {
          return mod.run({ sock, msg, args, logger, chatId, senderId, isGroup });
        }
      }

      // 3) Fallback لأوامر مدمجة بسيطة (إن لم تكن موجودة في commands/)
      //    نفس أسماء README تقريبًا
      const [cmd, ...args] = text.split(/\s+/);
      const cmdLower = cmd.toLowerCase();
      const argText = args.join(" ");

      switch (cmdLower) {
        case "!ping":
        case "ping": {
          const ts = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
          const latency = Date.now() - ts;
          await reply(`🏓 Pong! ~${latency >= 0 ? latency : 0}ms`);
          return;
        }
        case "!time":
        case "time": {
          await reply(`🕒 Server Time: ${new Date().toLocaleString()}`);
          return;
        }
        case "!id":
        case "id": {
          await reply(`🆔 Chat: ${chatId}\n👤 Sender: ${senderId}\n👥 Group: ${isGroup ? "Yes" : "No"}`);
          return;
        }
        case "!echo":
        case "echo": {
          if (!argText) return reply("اكتب هكذا: `!echo نص`");
          await reply(argText);
          return;
        }
        case "!help":
        case "help": {
          await reply(
            [
              "🤖 *Nexos Bot Commands*",
              "",
              "!hi / hi",
              "!ping / ping — قياس الاستجابة",
              "!time / time — وقت الخادم",
              "!id   / id   — معرف المحادثة والمرسل",
              "!echo / echo <نص> — يكرر النص",
              "!help / help — هذه القائمة",
            ].join("\n")
          );
          return;
        }
        default:
          // رد افتراضي لأي نص
          await reply(`🤖 تم استلام رسالتك: ${text}`);
          return;
      }
    } catch (err) {
      logger.error({ err, stack: err?.stack }, "messages.upsert handler error");
    }
  });
};
