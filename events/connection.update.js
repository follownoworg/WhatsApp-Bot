// Event Handler: connection.update
// Description: Handles WhatsApp connection updates, QR code display as PNG, and reconnection logic.
// Triggers on connection state changes (open, close, QR required).

const QRCode = require("qrcode");
const { Boom } = require("@hapi/boom");
const { DisconnectReason, delay } = require("@whiskeysockets/baileys");
const path = require("path");

module.exports = {
  eventName: "connection.update",
  /**
   * Handles connection state changes, QR code display, and reconnection.
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
        // حفظ QR كصورة بدلاً من عرضه في التيرمنال
        const qrPath = path.join(__dirname, "qr.png");
        QRCode.toFile(qrPath, qr, { type: "png" }, (err) => {
          if (err) {
            logger.error("❌ Failed to generate QR:", err);
          } else {
            logger.info(`✅ QR code generated at: ${qrPath}`);
            logger.info("📱 Open qr.png and scan it with WhatsApp to login.");
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
