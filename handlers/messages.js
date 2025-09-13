// handlers/messages.js
const { loadCommands } = require("../lib/commandLoader");
const IgnoreChat = require("../models/IgnoreChat");
let commandsCache = null;

// ردود كلمات مفتاحية (اختياري)
let keywordReplies = {};
try {
  keywordReplies = require("../config/keywords");
} catch (_) {
  keywordReplies = {};
}

/**
 * تلميح افتراضي في "الخاص فقط" وكل 24 ساعة كحد أدنى لكل محادثة.
 * (ذاكرة مؤقتة تُصفّر عند إعادة التشغيل)
 */
const defaultHintLastSent = new Map(); // chatId -> timestamp(ms)
const HINT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 ساعة

/** نص الرسالة الافتراضية */
const DEFAULT_HINT_TEXT = [
  "👋 أهلاً وسهلاً! أنا بوت واتساب تابع للمطوّر *بسام حميد*.",
  "",
  "لعرض الأوامر: أرسل *مساعدة*.",
  "ولو عندك استفسار للدعم، اكتب رسالتك الآن وأنا أوصلها. 🙏",
].join("\n");

module.exports = function registerMessageHandlers(sock, logger) {
  if (!commandsCache) {
    commandsCache = loadCommands(logger); // تحميل أوامر مجلد commands/ مرة واحدة
  }

  // مجموعة بأسماء الأوامر (والمرادفات) لمنع تعارضها مع الكلمات المفتاحية
  const commandWords = new Set();
  if (commandsCache && commandsCache.size > 0) {
    for (const mod of commandsCache.values()) {
      if (mod?.name) commandWords.add(String(mod.name).toLowerCase());
      if (Array.isArray(mod?.aliases)) {
        for (const a of mod.aliases) commandWords.add(String(a).toLowerCase());
      }
    }
    ["اختبار", "الوقت", "المعرف", "مساعدة", "id"].forEach((w) => commandWords.add(w));
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

      // === (1) فحص قائمة التجاهل مبكرًا ===
      // لو هذه الدردشة مُتجاهلة → لا نرسل أوامر ولا ردود ثابتة ولا تلميح.
      const ignored = await IgnoreChat.exists({ chatId });
      if (ignored) {
        return; // صمت تام لهذه الدردشة فقط
      }

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

      // === (2) أوامر من مجلد commands/ (بدون "!") ===
      const [firstWordRaw, ...args] = text.split(/\s+/);
      const firstWord = (firstWordRaw || "").toLowerCase();

      if (commandsCache && commandsCache.size > 0) {
        const mod = commandsCache.get(firstWord);
        if (mod && typeof mod.run === "function") {
          return mod.run({ sock, msg, args, logger, chatId, senderId, isGroup });
        }
      }

      // === (3) Fallback لأوامر بسيطة بالعربية ===
      switch (firstWord) {
        case "اختبار": {
          const ts = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
          const latency = Date.now() - ts;
          await reply(`🏓 اختبار الاستجابة: ~${latency >= 0 ? latency : 0} ملّي ثانية`);
          return;
        }
        case "الوقت": {
          await reply(
            `🕒 الوقت الحالي: ${new Date().toLocaleString("ar-YE", { timeZone: "Asia/Aden" })}`
          );
          return;
        }
        case "المعرف":
        case "id": {
          await reply(
            `🆔 المحادثة: ${chatId}\n👤 المرسل: ${senderId}\n👥 مجموعة: ${isGroup ? "نعم" : "لا"}`
          );
          return;
        }
        case "مساعدة": {
          await reply(
            [
              "🤖 *قائمة الأوامر*",
              "",
              "👋 مرحبا — ترحيب وتعريف سريع",
              "🏓 اختبار — قياس الاستجابة",
              "🕒 الوقت — عرض الوقت الحالي",
              "🆔 المعرف — عرض معرفات المحادثة",
              "📄 مساعدة — هذه القائمة",
            ].join("\n")
          );
          return;
        }
      }

      // === (4) ردود كلمات مفتاحية (بدون تعارض مع الأوامر) ===
      const lower = text.toLowerCase();
      if (!commandWords.has(lower) && keywordReplies[lower]) {
        await reply(keywordReplies[lower]);
        return;
      }

      // === (5) الرسالة الافتراضية — في الخاص فقط، وكل 24 ساعة كحد أدنى ===
      if (!isGroup) {
        const now = Date.now();
        const last = defaultHintLastSent.get(chatId) || 0;
        if (now - last >= HINT_INTERVAL_MS) {
          await reply(DEFAULT_HINT_TEXT);
          defaultHintLastSent.set(chatId, now);
        }
      }
      // في المجموعات: لا شيء افتراضي
    } catch (err) {
      logger.error({ err, stack: err?.stack }, "messages.upsert handler error");
    }
  });
};
