// Event Handler: connection.update
// Description: Handles WhatsApp connection updates, QR code display as PNG, 
// sends it to Telegram, and manages reconnection logic.

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { Boom } = require("@hapi/boom");
const { DisconnectReason, delay } = require("@whiskeysockets/baileys");
const TelegramBot = require("node-telegram-bot-api");

// إعداد بوت تيليجرام من متغيرات البيئة
const tgToken = process.env.TELEGRAM_TOKEN;
const adminId = process.env.TELEGRAM_ADMIN_ID;
const tgBot = tgToken ? new TelegramBot(tgToken) : null;

module.exports = {
  eventName: "connection.update",
  /**
   * Handles connection state changes, QR code display, Telegram sending, and reconnection.
   * @param {object} sock - The WhatsApp socket instance.
   * @param {object} logger - Logger for logging info and errors.
   * @param {Function} saveCreds - Function to save credentials.
   * @param {Function} startBot - Function to restart the bot if needed.
   * @returns {Function}
   */
  handler:
    (sock, logger, saveCreds, startBot) =>
    async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        const qrPath = path.join(__dirname, "qr.png");
        QRCode.toFile(qrPath, qr, { type: "png" }, async (err) => {
          if (err) {
            logger.error("❌ Failed to generate QR:", err);
          } else {
            logger.info(`✅ QR code generated at: ${qrPath}`);

            if (tgBot && adminId) {
              try {
                await tgBot.sendPhoto(adminId, fs.createReadStream(qrPath), {
                  caption: "📱 امسح هذا الكود لتسجيل الدخول في واتساب",
                });
                logger.info("📤 QR code sent to Telegram admin.");
              } catch (tgErr) {
                logger.error("❌ Failed to send QR to Telegram:", tgErr);
              }
            } else {
              logger.warn(
                "⚠️ Telegram bot not configured. Set TELEGRAM_TOKEN and TELEGRAM_ADMIN_ID in environment."
              );
            }
          }
        });
      }

      if (connection === "close") {
        const reasonCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = reasonCode !== DisconnectReason.loggedOut;
        logger.warn(
          `Connection closed. Code: ${reasonCode}. Reconnecting? ${shouldReconnect}`
        );
        if (shouldReconnect) {
          await delay(3000);
          startBot();
        } else {
          logger.error("Logged out. Please delete auth_info and re-authenticate.");
        }
      } else if (connection === "open") {
        logger.info("Connected to WhatsApp");
        // Send a message to the bot's (self-DM)
        try {
          const selfId = sock.user?.id || sock.user?.jid || sock.user;
          if (selfId) {
            await sock.sendMessage(selfId, {
              text: `*Thank you for Using Nexos Bot!* \n\n - *Official Discord Server:* https://discord.com/invite/A3euTAVqHv \n - *Server Time:* ${new Date().toLocaleString()} \n\n We ❤️ contributions!`,
            });
          } else {
            logger.warn("Could not determine bot's own WhatsApp ID for self-DM.");
          }
        } catch (err) {
          logger.error("Failed to send self-DM:", err);
        }
      }
    },
};
