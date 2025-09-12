// handlers/messages.js

/**
 * يسجّل مستمع الرسائل ويطبّق أوامر بسيطة.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {import('pino').Logger} logger
 */
module.exports = function registerMessageHandlers(sock, logger) {
  // === Listen for incoming messages & simple commands ===
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (!messages || !messages.length) return;
      const msg = messages[0];

      // تجاهل رسائل الحالة والرسائل من البوت نفسه
      if (msg.key?.remoteJid === "status@broadcast") return;
      if (msg.key?.fromMe) return;

      const chatId = msg.key.remoteJid;            // JID للمحادثة (فردي/قروب)
      const isGroup = chatId?.endsWith("@g.us");
      const senderId =
        (msg.key?.participant || msg.key?.remoteJid || "").split(":")[0]; // مرسل داخل القروب أو فردي

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

      // دالة رد قصيرة
      const reply = (t) => sock.sendMessage(chatId, { text: t }, { quoted: msg });

      // أوامر بسيطة (بادئة !)
      const isCmd = text.startsWith("!");
      const [cmd, ...args] = text.split(/\s+/);
      const argText = args.join(" ");

      if (isCmd) {
        switch (cmd.toLowerCase()) {
          case "!ping": {
            // تقدير بسيط للـ latency من وقت الرسالة
            const ts = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
            const latency = Date.now() - ts;
            await reply(`🏓 Pong! ~${latency >= 0 ? latency : 0}ms`);
            break;
          }

          case "!time": {
            await reply(`🕒 Server Time: ${new Date().toLocaleString()}`);
            break;
          }

          case "!id": {
            await reply(
              `🆔 Chat: ${chatId}\n👤 Sender: ${senderId}\n👥 Group: ${isGroup ? "Yes" : "No"}`
            );
            break;
          }

          case "!echo": {
            if (!argText) return reply("اكتب هكذا: `!echo نص`");
            await reply(argText);
            break;
          }

          case "!help": {
            await reply(
              [
                "🤖 *Nexos Bot Commands*",
                "",
                "!ping  — قياس الاستجابة",
                "!time  — وقت الخادم",
                "!id    — معرف المحادثة والمرسل",
                "!echo <نص> — يكرر النص",
                "!help  — هذه القائمة",
              ].join("\n")
            );
            break;
          }

          default:
            await reply("❓ أمر غير معروف. اكتب `!help` لمعرفة الأوامر.");
        }
        return;
      }

      // رد افتراضي على أي رسالة نصية ليست أمرًا
      await reply(`🤖 تم استلام رسالتك: ${text}`);
      // ملاحظة: يمكنك تخصيص ردود حسب كلمات مفتاحية هنا.
    } catch (err) {
      // لوج الخطأ بدون إسقاط العملية
      logger.error({ err, stack: err?.stack }, "messages.upsert handler error");
    }
  });
};
