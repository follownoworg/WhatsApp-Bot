// handlers/messages.js
const { loadCommands } = require("../lib/commandLoader");
let commandsCache = null;

// ردود كلمات مفتاحية (اختياري)
let keywordReplies = {};
try {
  keywordReplies = require("../config/keywords");
} catch (_) {
  keywordReplies = {};
}

/**
 * نريد إرسال رسالة افتراضية مرة واحدة فقط لكل محادثة
 * نستخدم Set في الذاكرة لتتبع المحادثات التي أُرسلت لها الرسالة.
 * ملاحظة: يعاد ضبطها عند إعادة تشغيل العملية (وهو سلوك مقبول لمعظم الحالات).
 */
const defaultHintSentChats = new Set();

/** نص الرسالة الافتراضية (مرّة واحدة) */
const DEFAULT_HINT_TEXT = [
  "👋 أهلاً بك! أنا بوت واتساب.",
  "",
  "للحصول على قائمة الأوامر أرسل: *مساعدة* أو *halp*",
  "وإن كنت تريد مراسلة الدعم، أرسل استفسارك الآن وسنرد عليك في أقرب وقت ممكن. 🙏",
].join("\n");

/**
 * يسجّل مستمع الرسائل ويطبّق:
 * - أوامر من مجلد commands/ (لو موجود) مع وبدون "!"
 * - ردود كلمات مفتاحية من config/keywords.js (اختياري)
 * - أوامر مدمجة بسيطة كـ fallback
 * - رسالة افتراضية تُرسل مرة واحدة فقط عند عدم التطابق مع أي أمر/كلمة
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

      // استخراج نص الرسالة من أكثر من نوع
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
        const key1 = firstWord.toLowerCase();                         // كما هي
        const key2 = key1.startsWith("!") ? key1.slice(1) : "!" + key1; // معكوسة

        const mod = commandsCache.get(key1) || commandsCache.get(key2);
        if (mod && typeof mod.run === "function") {
          return mod.run({ sock, msg, args, logger, chatId, senderId, isGroup });
        }
      }

      // 3) Fallback لأوامر مدمجة بسيطة بالعربية
      const [cmd, ...args] = text.split(/\s+/);
      const argText = args.join(" ");
      const cmdLower = cmd.toLowerCase();

      switch (cmdLower) {
        case "!اختبار":
        case "اختبار":
        case "!ping":
        case "ping": {
          const ts = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
          const latency = Date.now() - ts;
          await reply(`🏓 اختبار الاستجابة: ~${latency >= 0 ? latency : 0} مللي ثانية`);
          return;
        }
        case "!الوقت":
        case "الوقت":
        case "!time":
        case "time": {
          await reply(`🕒 الوقت الحالي: ${new Date().toLocaleString("ar-EG", { timeZone: "Asia/Riyadh" })}`);
          return;
        }
        case "!id":
        case "id": {
          await reply(`🆔 المحادثة: ${chatId}\n👤 المرسل: ${senderId}\n👥 مجموعة: ${isGroup ? "نعم" : "لا"}`);
          return;
        }
        case "!echo":
        case "echo": {
          if (!argText) return reply("اكتب هكذا: `!echo نص`");
          await reply(argText);
          return;
        }
        case "!مساعدة":
        case "مساعدة":
        case "!help":
        case "help":
        case "halp": {
          await reply(
            [
              "🤖 *قائمة أوامر البوت*",
              "",
              "👋 !مرحبا / مرحبا — للترحيب",
              "🏓 !اختبار / اختبار — قياس الاستجابة",
              "🕒 !الوقت / الوقت — عرض الوقت الحالي",
              "🆔 !id / id — عرض معرف المحادثة والمرسل",
              "📢 !echo / echo <نص> — يكرر النص",
              "🖼️ !صورة / صورة <رابط> — إرسال صورة من رابط",
              "📊 !تصويت / تصويت سؤال | خيار1, خيار2 — إنشاء تصويت",
            ].join("\n")
          );
          return;
        }
        // لا default هنا — سننتقل إلى الرسالة الافتراضية الأحادية بالأسفل
      }

      // 4) الرسالة الافتراضية — تُرسل مرة واحدة فقط لكل محادثة
      if (!defaultHintSentChats.has(chatId)) {
        await reply(DEFAULT_HINT_TEXT);
        defaultHintSentChats.add(chatId);
      }
      // إذا كانت قد أرسلت سابقًا لنفس المحادثة، لا نفعل شيئًا لتجنب التشويش.

    } catch (err) {
      logger.error({ err, stack: err?.stack }, "messages.upsert handler error");
    }
  });
};
