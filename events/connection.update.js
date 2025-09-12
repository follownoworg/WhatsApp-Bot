// events/connection.update.js
// Handles WhatsApp connection updates, robust QR delivery to Telegram, and reconnection.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { Boom } = require("@hapi/boom");
const { DisconnectReason, delay } = require("@whiskeysockets/baileys");

/**
 * Factory to create connection.update handler with injected deps
 * @param {Object} deps
 * @param {import('pino').Logger} deps.logger
 * @param {import('node-telegram-bot-api')} [deps.tgBot]
 * @param {string|number} [deps.adminId]
 * @param {Function} deps.startBot
 * @param {Object} deps.QRCode (qrcode lib)
 */
module.exports = ({ logger, tgBot, adminId, startBot, QRCode }) =>
  (sock) =>
  async ({ connection, lastDisconnect, qr }) => {
    // ---- QR handling (send to Telegram if available) ----
    if (qr && tgBot && adminId) {
      try {
        // Buffer first
        const buffer = await QRCode.toBuffer(qr, { type: "png" });
        await tgBot.sendPhoto(adminId, buffer, {
          caption: "📱 امسح هذا الكود لتسجيل الدخول في واتساب",
        });
        logger.info("📤 QR code sent to Telegram (buffer).");
      } catch (bufErr) {
        logger.error({ err: bufErr }, "❌ Failed to send QR buffer to Telegram. Falling back to file.");

        // Fallback to file in /tmp
        try {
          const tmpPath = path.join(os.tmpdir(), "qr.png");
          await QRCode.toFile(tmpPath, qr, { type: "png" });
          await tgBot.sendPhoto(adminId, fs.createReadStream(tmpPath), {
            caption: "📱 امسح هذا الكود لتسجيل الدخول في واتساب",
          });
          logger.info(`📤 QR code generated & sent to Telegram from file: ${tmpPath}`);
        } catch (fileErr) {
          logger.error(
            { err: fileErr },
            "❌ QR generation/telegram send failed (both buffer and file). Ensure TELEGRAM_ADMIN_ID is numeric chat id and you've /start-ed the bot."
          );
        }
      }
    }

    // ---- Connection closed -> maybe reconnect ----
    if (connection === "close") {
      const reasonCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reasonCode !== DisconnectReason.loggedOut;
      logger.warn(`Connection closed. Code: ${reasonCode}. Reconnecting? ${shouldReconnect}`);
      if (shouldReconnect) {
        await delay(3000);
        startBot();
      } else {
        logger.error("Logged out. Please reauthenticate.");
      }
      return;
    }

    // ---- Connection open -> send self DM ----
    if (connection === "open") {
      logger.info("✅ Connected to WhatsApp");
      try {
        const selfId = sock.user?.id || sock.user?.jid || sock.user;
        if (selfId) {
          await sock.sendMessage(selfId, {
            text:
              `*Thank you for Using Nexos Bot!*\n\n` +
              `- *Official Discord Server:* https://discord.com/invite/A3euTAVqHv\n` +
              `- *Server Time:* ${new Date().toLocaleString()}\n\n` +
              `We ❤️ contributions!`,
          });
        } else {
          logger.warn("Could not determine self WhatsApp ID to DM.");
        }
      } catch (err) {
        logger.error({ err }, "Failed to send self-DM");
      }
    }
  };
