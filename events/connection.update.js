// events/connection.update.js
const { Boom } = require("@hapi/boom");
const { DisconnectReason, delay } = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");

module.exports = ({ logger, tgBot, adminId, startBot, QRCode }) => {
  // تدرّج التأخير بين المحاولات (3s,5s,8s,13s,21s ثم 30s ثابت) + jitter
  let attempt = 0;
  let lastOpenAt = 0; // للتعرّف على flapping بعد الفتح مباشرة

  function backoffMs() {
    const table = [3000, 5000, 8000, 13000, 21000];
    const base = table[Math.min(attempt, table.length - 1)] || 30000;
    const jitter = Math.floor(Math.random() * 2000); // 0-2s
    return base + jitter;
  }

  // عندما يحدث إغلاق خلال 10 ثوانٍ من آخر فتح، نعتبرها flapping ونأخذ مهلة أكبر
  function flapBackoffMs() {
    const base = 45000; // 45s
    const jitter = Math.floor(Math.random() * 5000); // 0-5s
    return base + jitter;
  }

  return (sock) => async (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;

      // --- QR إلى تيليجرام (إن مفعّل) ---
      if (qr && tgBot && adminId) {
        try {
          const file = path.join(__dirname, "..", "qr.png");
          await QRCode.toFile(file, qr, { type: "png" });
          await tgBot.sendPhoto(adminId, fs.createReadStream(file), {
            caption: "📱 امسح هذا الكود لتسجيل الدخول في واتساب",
          });
          logger.info("📤 QR code sent to Telegram admin.");
        } catch (e) {
          logger.error({ e }, "❌ Failed to send QR to Telegram");
        }
      }

      if (connection === "open") {
        attempt = 0;
        lastOpenAt = Date.now();
        logger.info("✅ Connected to WhatsApp");
        return;
      }

      if (connection === "close") {
        const boom = new Boom(lastDisconnect?.error);
        const code = boom.output?.statusCode;
        const reasonStr = code || lastDisconnect?.error?.message || "unknown";
        logger.warn(`Connection closed. Code: ${reasonStr}.`);

        if (code === DisconnectReason.loggedOut) {
          logger.error("⛔ Logged out. Delete session in MongoDB and re-authenticate.");
          return;
        }

        // لو أغلق بعد فتح حديث (<10s) اعتبرها flapping وخذ مهلة أطول
        const sinceOpen = Date.now() - (lastOpenAt || 0);
        let wait;
        if (sinceOpen > 0 && sinceOpen < 10_000) {
          wait = flapBackoffMs();
          logger.warn(`🪫 Flapping detected (<10s after open). Waiting ~${Math.round(wait/1000)}s before retry.`);
        } else {
          attempt += 1;
          wait = backoffMs();
          logger.warn(`🔄 Reconnecting in ~${Math.round(wait / 1000)}s (attempt ${attempt})`);
        }
        await delay(wait);
        startBot();
      }
    } catch (err) {
      logger.error({ err }, "connection.update handler error");
    }
  };
};
