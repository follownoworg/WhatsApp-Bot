/**
 * WhatsApp Bot Entry Point with MongoDB session storage and Express server
 */
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const express = require("express");
const mongoose = require("mongoose");
const config = require("./utils");
const QRCode = require("qrcode");
const TelegramBot = require("node-telegram-bot-api");

// --------------------- Logger Setup ---------------------
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
const logger = pino(
  { level: config.logging?.level || "info", transport: { target: "pino-pretty" } },
  pino.destination(logFile)
);

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

// --------------------- Express Server ---------------------
const app = express();
const port = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("WhatsApp Bot running"));
app.listen(port, () => logger.info(`HTTP server running on port ${port}`));

// --------------------- Start Bot ---------------------
async function startBot() {
  // Try to load session from MongoDB
  let authState;
  const saved = await Session.findOne({ name: "auth_info" }).lean();
  if (saved && saved.data) {
    authState = saved.data;
    logger.info("✅ Loaded session from MongoDB.");
  } else {
    authState = undefined;
    logger.info("⚠️ No session found, will generate QR for first login.");
  }

  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Using Baileys v${version.join(".")}, Latest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["NexosBot", "Opera GX", "120.0.5543.204"],
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: config.bot?.online ?? true,
    syncFullHistory: config.bot?.history ?? false,
    shouldSyncHistoryMessage: config.bot?.history ?? false,
  });

  // Save credentials to MongoDB on update
  sock.ev.on("creds.update", async (newCreds) => {
    await Session.updateOne(
      { name: "auth_info" },
      { $set: { data: newCreds } },
      { upsert: true }
    );
    logger.info("✅ Updated session in MongoDB.");
  });

  // --------------------- QR Handling ---------------------
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && tgBot && adminId) {
      const qrPath = path.join(__dirname, "qr.png");
      await QRCode.toFile(qrPath, qr, { type: "png" });
      try {
        await tgBot.sendPhoto(adminId, fs.createReadStream(qrPath), {
          caption: "📱 امسح هذا الكود لتسجيل الدخول في واتساب",
        });
        logger.info("📤 QR code sent to Telegram admin.");
      } catch (err) {
        logger.error("❌ Failed to send QR to Telegram:", err);
      }
    }

    if (connection === "close") {
      const reasonCode = new Error(lastDisconnect?.error)?.message || "Unknown";
      const shouldReconnect = reasonCode !== "loggedOut";
      logger.warn(`Connection closed. Code: ${reasonCode}. Reconnecting? ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        logger.error("Logged out. Please reauthenticate.");
      }
    } else if (connection === "open") {
      logger.info("✅ Connected to WhatsApp");
    }
  });
}

startBot();
