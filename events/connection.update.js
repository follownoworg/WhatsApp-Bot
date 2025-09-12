// Event Handler: connection.update
// Description: Handles WhatsApp connection updates, QR code display as PNG, 
// sends it to Telegram, and manages reconnection logic with MongoDB session storage.

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { Boom } = require("@hapi/boom");
const { DisconnectReason, delay } = require("@whiskeysockets/baileys");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

// --------------------- MongoDB Setup ---------------------
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("❌ Missing MONGODB_URI in environment variables.");
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const sessionSchema = new mongoose.Schema({ name: String, data: Object });
const Session = mongoose.model("Session", sessionSchema);

// --------------------- Telegram Setup ---------------------
const tgToken = process.env.TELEGRAM_TOKEN;
const adminId = process.env.TELEGRAM_ADMIN_ID;
const tgBot = tgToken && adminId ? new TelegramBot(tgToken, { polling: false }) : null;

module.exports = {
  eventName: "connection.update",
  handler:
    (sock, logger, saveCreds, startBot) =>
    async ({ connection, lastDisconnect, qr }) => {
      // --------------------- Handle QR ---------------------
      if (qr && tgBot && adminId) {
        const qrPath = path.join(__dirname, "qr.png");
        QRCode.toFile(qrPath, qr, { type: "png" }, async (err) => {
          if (err) {
            logger.error("❌ Failed to generate QR:", err);
          } else {
            logger.info(`✅ QR code generated at: ${qrPath}`);
            try {
              await tgBot.sendPhoto(adminId, fs.createReadStream(qrPath), {
                caption: "📱 امسح هذا الكود لتسجيل الدخول في واتساب",
              });
              logger.info("📤 QR code sent to Telegram admin.");
            } catch (tgErr) {
              logger.error("❌ Failed to send QR to Telegram:", tgErr);
            }
          }
        });
      }

      // --------------------- Connection Close Handling ---------------------
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
          logger.error("Logged out. Please reauthenticate.");
        }
      }

      // --------------------- Connection Open Handling ---------------------
      else if (connection === "open") {
        logger.info("✅ Connected to WhatsApp");

        // --------------------- Save session to MongoDB ---------------------
        sock.ev.on("creds.update", async (newCreds) => {
          try {
            await Session.updateOne(
              { name: "auth_info" },
              { $set: { data: newCreds } },
              { upsert: true }
            );
            logger.info("✅ Updated session in MongoDB.");
          } catch (err) {
            logger.error("❌ Failed to save session to MongoDB:", err);
          }
        });

        // --------------------- Send Self-DM ---------------------
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
