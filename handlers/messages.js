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

// ===== Helpers =====
function toJid(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (s.includes("@")) return s;
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

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

  const ADMIN_WA = (process.env.ADMIN_WA || "").replace(/\D+/g, ""); // مثال: 967713121581

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

      // ===== (0) أوامر واتساب إدارية (للأدمن فقط) — تُعالج دائمًا حتى لو الدردشة مُتجاهلة =====
      const lowerText = text.toLowerCase();
      const adminIsSender =
        ADMIN_WA &&
        (senderId.includes(ADMIN_WA) || chatId.includes(`${ADMIN_WA}@s.whatsapp.net`));

      if (adminIsSender) {
        // تجاهل <رقم>
        let m = lowerText.match(/^تجاهل\s+(.+)$/);
        if (m) {
          const jid = toJid(m[1]);
          if (!jid) return reply("❌ رقم/معرّف غير صالح.");
          await IgnoreChat.updateOne({ chatId: jid }, { $set: { chatId: jid, addedBy: "wa-admin" } }, { upsert: true });
          return reply(`✅ تم تجاهل المحادثة: ${jid}`);
        }

        // سماح <رقم>
        m = lowerText.match(/^سماح\s+(.+)$/);
        if (m) {
          const jid = toJid(m[1]);
          if (!jid) return reply("❌ رقم/معرّف غير صالح.");
          const res = await IgnoreChat.deleteOne({ chatId: jid });
          if (res.deletedCount > 0) return reply(`✅ أُلغي التجاهل عن: ${jid}`);
          return reply("ℹ️ هذه المحادثة ليست في قائمة التجاهل.");
        }

        // قائمة_التجاهل
        if (lowerText === "قائمة_التجاهل") {
          const rows = await IgnoreChat.find({}).sort({ createdAt: -1 }).limit(100).lean();
          if (!rows.length) return reply("📭 لا توجد محادثات متجاهلة.");
          const body = rows
            .map((r, i) => `${i + 1}. ${r.chatId} — ${new Date(r.createdAt).toLocaleString("ar-YE")}`)
            .join("\n");
          return reply(`📝 قائمة التجاهل:\n\n${body}`);
        }
      }

      // ===== (1) فحص قائمة التجاهل لهذه الدردشة =====
      const ignored = await IgnoreChat.exists({ chatId });
      if (ignored) {
        return; // صمت تام لهذه الدردشة فقط
      }

      // ===== (2) أوامر من مجلد commands/ (بدون "!") =====
      const [firstWordRaw, ...args] = text.split(/\s+/);
      const firstWord = (firstWordRaw || "").toLowerCase();

      if (commandsCache && commandsCache.size > 0) {
        const mod = commandsCache.get(firstWord);
        if (mod && typeof mod.run === "function") {
          return mod.run({ sock, msg, args, logger, chatId, senderId, isGroup });
        }
      }

      // ===== (3) Fallback لأوامر بسيطة بالعربية =====
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

      // ===== (4) ردود كلمات مفتاحية (بدون تعارض مع الأوامر) =====
      if (!commandWords.has(lowerText) && keywordReplies[lowerText]) {
        await reply(keywordReplies[lowerText]);
        return;
      }

      // ===== (5) الرسالة الافتراضية — في الخاص فقط، وكل 24 ساعة كحد أدنى =====
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
