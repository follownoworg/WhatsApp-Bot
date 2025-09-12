/**
 * WhatsApp Bot Entry Point
 * - MongoDB session storage
 * - Express health server
 * - Telegram QR delivery (optional)
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const pino = require("pino");
const { default: makeWASocket, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const TelegramBot = require("node-telegram-bot-api");

// ---------- Config ----------
const {
  MONGODB_URI,
  TELEGRAM_TOKEN,
  TELEGRAM_ADMIN_ID,
  PORT = 3000,
  LOG_LEVEL = "info",
} = process.env;

if (!MONGODB_URI) {
  throw new Error("❌ Missing MONGODB_URI in environment variables.");
}

// ---------- Logger ----------
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
const logFile = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.log`);

const logger = pino(
  { level: LOG_LEVEL, transport: { target: "pino-pretty" } },
  pino.destination(logFile)
);

// ---------- Mongo ----------
mongoose
  .connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .catch((err) => {
    logger.error("Mongo initial connection error:", err);
    process.exit(1);
  });

mongoose.connection.on("connected", () => logger.info("✅ Mongo connected"));
mongoose.connection.on("error", (err) => logger.error("Mongo connection error:", err));

const sessionSchema = new mongoose.Schema({ name: String, data: Object });
const Session = mongoose.model("Session", sessionSchema);

// ---------- Telegram (optional) ----------
const tgBot = TELEGRAM_TOKEN && TELEGRAM_ADMIN_ID
  ? new TelegramBot(TELEGRAM_TOKEN, { polling: false })
  : null;

// ---------- Express ----------
const app = express();
app.get("/", (_req, res) => res.send("WhatsApp Bot running"));
app.listen(PORT, () => logger.info(`HTTP server running on port ${PORT}`));

// ---------- Start Bot ----------
async function startBot() {
  try {
    // Load saved session (if any)
    let authState;
    const saved = await Session.findOne({ name: "auth_info" }).lean();
    if (saved && saved.data) {
      authState = saved.data;
      logger.info("✅ Loaded session from MongoDB.");
    } else {
      logger.warn("⚠️ No session found. Will generate QR on first login.");
    }

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using Baileys v${version.join(".")} | latest: ${isLatest}`);

    const sock = makeWASocket({
      version,
      auth: authState, // undefined on first run
      printQRInTerminal: !tgBot, // اطبع QR في الطرفية إذا لم يتوفر تيليجرام
      logger: pino({ level: "silent" }),
      browser: ["NexosBot", "Opera GX", "120.0.5543.204"],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldSyncHistoryMessage: false,
    });

    // Persist credentials on every update
    sock.ev.on("creds.update", async (newCreds) => {
      try {
        await Session.updateOne(
          { name: "auth_info" },
          { $set: { data: newCreds } },
          { upsert: true }
        );
        logger.info("💾 Session updated in MongoDB.");
      } catch (err) {
        logger.error("❌ Failed to save session:", err);
      }
    });

    // Attach connection.update handler
    const connectionUpdateHandler = require("./events/connection.update")({
      logger,
      tgBot,
      adminId: TELEGRAM_ADMIN_ID,
      startBot, // for auto-reconnect
      QRCode,
    });

    sock.ev.on("connection.update", connectionUpdateHandler(sock));
  } catch (err) {
    logger.error("startBot fatal error:", err);
    setTimeout(startBot, 5000); // retry on fatal error
  }
}

startBot();
