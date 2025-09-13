/**
 * WhatsApp Bot Entry Point
 * - Full MongoDB auth state for Baileys (creds + signal keys)
 * - Express health server
 * - Telegram QR delivery (buffer + file fallback)
 * - Auto-load commands/ via handlers/messages
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const pino = require("pino");
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const TelegramBot = require("node-telegram-bot-api");

// ✅ استيراد هاندلر الرسائل (يشغّل أوامر مجلد commands/ + كلمات مفتاحية إن وُجدت)
const registerMessageHandlers = require("./handlers/messages");

// ---------- Config ----------
const {
  TELEGRAM_TOKEN,
  TELEGRAM_ADMIN_ID, // numeric chat id
  PORT = 3000,
  LOG_LEVEL = "info",
} = process.env;

// يدعم الاسمين للاتساق مع إعدادك على Render
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URL;
if (!MONGODB_URI) {
  throw new Error("❌ Missing MONGODB_URI (or MONGODB_URL) in environment variables.");
}

// ---------- Logger (console prettified) ----------
const logger = pino({
  level: LOG_LEVEL,
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// ---------- Mongo ----------
mongoose
  .connect(MONGODB_URI)
  .catch((err) => {
    logger.error({ err }, "Mongo initial connection error");
    process.exit(1);
  });

mongoose.connection.on("connected", () => logger.info("✅ Mongo connected"));
mongoose.connection.on("error", (err) => logger.error({ err }, "Mongo connection error"));

// ---------- Schemas / Models for Baileys auth ----------
const credsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "creds" }, // ثابت
    data: { type: String, required: true }   // JSON.stringified with BufferJSON
  },
  { versionKey: false }
);

const keySchema = new mongoose.Schema(
  {
    type: { type: String, index: true },
    id: { type: String, index: true },
    value: { type: String, required: true } // JSON.stringified with BufferJSON
  },
  { versionKey: false }
);
keySchema.index({ type: 1, id: 1 }, { unique: true });

const CredsModel = mongoose.model("BaileysCreds", credsSchema);
const KeyModel = mongoose.model("BaileysKey", keySchema);

// ---------- Mongo Auth State for Baileys ----------
async function useMongoAuthState(logger) {
  // load creds (or init new)
  let credsDoc = await CredsModel.findById("creds").lean();
  let creds = credsDoc
    ? JSON.parse(credsDoc.data, BufferJSON.reviver)
    : initAuthCreds();

  // signal key store (get/set/clear)
  const signalKeyStore = {
    get: async (type, ids) => {
      const find = await KeyModel.find({ type, id: { $in: ids } }).lean();
      const result = {};
      for (const doc of find) {
        result[doc.id] = JSON.parse(doc.value, BufferJSON.reviver);
      }
      return result;
    },
    set: async (data) => {
      const bulk = KeyModel.collection.initializeUnorderedBulkOp();
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const value = JSON.stringify(data[type][id], BufferJSON.replacer);
          bulk.find({ type, id }).upsert().replaceOne({ type, id, value });
        }
      }
      if (bulk.length > 0) await bulk.execute();
    },
    clear: async () => {
      await KeyModel.deleteMany({});
    },
  };

  const keys = makeCacheableSignalKeyStore(signalKeyStore, logger);

  async function saveCreds() {
    const data = JSON.stringify(creds, BufferJSON.replacer);
    await CredsModel.findByIdAndUpdate("creds", { data }, { upsert: true, new: true });
  }

  const state = { creds, keys };
  return { state, saveCreds };
}

// ---------- Telegram (optional) ----------
const tgBot = TELEGRAM_TOKEN && TELEGRAM_ADMIN_ID
  ? new TelegramBot(TELEGRAM_TOKEN, { polling: false })
  : null;

// رسالة اختبار عند الإقلاع
(async () => {
  if (tgBot) {
    try {
      await tgBot.sendMessage(
        TELEGRAM_ADMIN_ID,
        "🚀 Nexos WhatsApp bot started. QR will arrive here."
      );
      logger.info("📨 Sent startup test message to Telegram admin.");
    } catch (err) {
      logger.error(
        { err },
        "❌ Failed to send startup test message to Telegram. Ensure /start and numeric chat id."
      );
    }
  } else {
    logger.warn("ℹ️ Telegram not configured (missing TELEGRAM_TOKEN/TELEGRAM_ADMIN_ID).");
  }
})();

// ---------- Express ----------
const app = express();

// ✅ وسيط لتسجيل زيارات /healthz حتى تتأكد أن المُوقِظ وصل
app.use((req, _res, next) => {
  if (req.path === "/healthz") {
    logger.info({ ua: req.headers["user-agent"] }, "🔁 /healthz ping");
  }
  next();
});

app.get("/", (_req, res) => res.send("WhatsApp Bot running"));
app.get("/healthz", (_req, res) => res.json({ ok: true })); // فحص سريع للنشر
app.listen(PORT, () => logger.info(`HTTP server running on port ${PORT}`));

// ---------- Start Bot ----------
async function startBot() {
  try {
    const { state, saveCreds } = await useMongoAuthState(logger);
    const hasCreds = !!state?.creds?.noiseKey; // مؤشر بسيط لوجود جلسة
    if (!hasCreds) logger.warn("⚠️ No session found. Will generate QR on first login.");

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using Baileys v${version.join(".")} | latest: ${isLatest}`);

    const sock = makeWASocket({
      version,
      auth: state, // ✅ Auth كامل (creds + keys)
      printQRInTerminal: !tgBot,
      logger: pino({ level: "silent" }),
      browser: ["NexosBot", "Opera GX", "120.0.5543.204"],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,

      // ✅ لتلقي الرسائل الفائتة بعد الاستيقاظ على الخطة المجانية
      syncFullHistory: true,
      shouldSyncHistoryMessage: true,

      getMessage: async () => undefined,
    });

    // حفظ الاعتمادات عند التحديث
    sock.ev.on("creds.update", saveCreds);

    // ربط هاندلر الاتصال (إرسال QR إلى تيليجرام بموثوقية)
    const connectionUpdateHandler = require("./events/connection.update")({
      logger,
      tgBot,
      adminId: TELEGRAM_ADMIN_ID,
      startBot, // لإعادة الاتصال
      QRCode,
    });
    sock.ev.on("connection.update", connectionUpdateHandler(sock));

    // ✅ تفعيل هاندلر الرسائل (يشغّل أوامر commands/ تلقائيًا + كلمات مفتاحية لو موجودة)
    registerMessageHandlers(sock, logger);

  } catch (err) {
    logger.error({ err, stack: err?.stack }, "startBot fatal error");
    setTimeout(startBot, 5000);
  }
}

startBot();
