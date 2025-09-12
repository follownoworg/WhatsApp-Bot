/**
 * WhatsApp Bot Entry Point
 * - MongoDB session storage
 * - Express health server
 * - Telegram QR delivery (robust)
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
  TELEGRAM_TOKEN,
  TELEGRAM_ADMIN_ID, // يجب أن يكون رقم chat id، وليس username
  PORT = 3000,
  LOG_LEVEL = "info",
} = process.env;

// يقبل الاسمين MONGODB_URI و MONGODB_URL
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URL;
if (!MONGODB_URI) {
  throw new Error("❌ Missing MONGODB_URI (or MONGODB_URL) in environment variables.");
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
  .connect(MONGODB_URI)
  .catch((err) => {
    logger.error({ err }, "Mongo initial connection error");
    process.exit(1);
  });

mongoose.connection.on("connected", () => logger.info("✅ Mongo connected"));
mongoose.connection.on("error", (err) => logger.error({ err }, "Mongo connection error"));

const sessionSchema = new mongoose.Schema({ name: String, data: Object });
const Session = mongoose.model("Session", sessionSchema);

// ---------- Telegram (optional) ----------
const tgBot = TELEGRAM_TOKEN && TELEGRAM_ADMIN_ID
  ? new TelegramBot(TELEGRAM_TOKEN, { polling: false })
  : null;

// أرسل رسالة اختبار عند الإقلاع للتأكد أن الإعداد صحيح
(async () => {
  if (tgBot) {
    try {
      await tgBot.sendMessage(TELEGRAM_ADMIN_ID, "🚀 Nexos WhatsApp bot started. QR will arrive here.");
      logger.info("📨 Sent startup test message to Telegram admin.");
    } catch (err) {
      logger.error({ err }, "❌ Failed to send startup test message to Telegram. Tips: ensure you've /start-ed the bot and TELEGRAM_ADMIN_ID is a numeric chat id.");
    }
  } else {
    logger.warn("ℹ️ Telegram bot not configured (missing TELEGRAM_TOKEN or TELEGRAM_ADMIN_ID). QR will print in terminal.");
  }
})();

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
      auth: authState,
      printQRInTerminal: !tgBot, // إن لم يتوفر تيليجرام اطبع في الطرفية
      logger: pino({ level: "silent" }),
      browser: ["NexosBot", "Opera GX", "120.0.5543.204"],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      shouldSyncHistoryMessage: false,
      getMessage: async (_key) => undefined, // مهم لتجنّب أعطال داخلية
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
        logger.error({ err }, "❌ Failed to save session");
      }
    });

    // Attach connection.update handler (مع إرسال QR إلى تيليجرام)
    const connectionUpdateHandler = require("./events/connection.update")({
      logger,
      tgBot,
      adminId: TELEGRAM_ADMIN_ID,
      startBot, // for auto-reconnect
      QRCode,
    });

    sock.ev.on("connection.update", connectionUpdateHandler(sock));
  } catch (err) {
    logger.error({ err, stack: err?.stack }, "startBot fatal error");
    setTimeout(startBot, 5000); // retry on fatal error
  }
}

startBot();
