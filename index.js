/**
 * WhatsApp Bot Entry Point
 * - Full MongoDB auth state for Baileys (creds + signal keys)
 * - Express health server (+ log pings)
 * - Telegram QR delivery
 * - Auto-load commands via handlers/messages
 */

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

// ✅ هاندلر الرسائل (يشغّل أوامر commands/ + كلمات مفتاحية إن وُجدت)
const registerMessageHandlers = require("./handlers/messages");

// ---------- Config ----------
const {
  TELEGRAM_TOKEN,
  TELEGRAM_ADMIN_ID, // numeric chat id
  PORT = 3000,
  LOG_LEVEL = "info",
} = process.env;

// يدعم الاسمين للاتساق مع إعداد Render
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URL;
if (!MONGODB_URI) throw new Error("❌ Missing MONGODB_URI (or MONGODB_URL)");

// ---------- Logger ----------
const logger = pino({
  level: LOG_LEVEL,
  transport: { target: "pino-pretty", options: { colorize: true } },
});

// ---------- Mongo ----------
mongoose.connect(MONGODB_URI).catch((err) => {
  logger.error({ err }, "Mongo initial connection error");
  process.exit(1);
});
mongoose.connection.on("connected", () => logger.info("✅ Mongo connected"));
mongoose.connection.on("error", (err) => logger.error({ err }, "Mongo connection error"));

// ---------- Schemas / Models for Baileys auth ----------
const credsSchema = new mongoose.Schema(
  { _id: { type: String, default: "creds" }, data: { type: String, required: true } },
  { versionKey: false }
);
const keySchema = new mongoose.Schema(
  { type: { type: String, index: true }, id: { type: String, index: true }, value: { type: String, required: true } },
  { versionKey: false }
);
keySchema.index({ type: 1, id: 1 }, { unique: true });

const CredsModel = mongoose.model("BaileysCreds", credsSchema);
const KeyModel = mongoose.model("BaileysKey", keySchema);

// ---------- Mongo Auth State ----------
async function useMongoAuthState(logger) {
  const credsDoc = await CredsModel.findById("creds").lean();
  const creds = credsDoc ? JSON.parse(credsDoc.data, BufferJSON.reviver) : initAuthCreds();

  const signalKeyStore = {
    get: async (type, ids) => {
      const rows = await KeyModel.find({ type, id: { $in: ids } }).lean();
      const out = {};
      for (const r of rows) out[r.id] = JSON.parse(r.value, BufferJSON.reviver);
      return out;
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
    clear: async () => KeyModel.deleteMany({}),
  };

  const keys = makeCacheableSignalKeyStore(signalKeyStore, logger);
  async function saveCreds() {
    const data = JSON.stringify(creds, BufferJSON.replacer);
    await CredsModel.findByIdAndUpdate("creds", { data }, { upsert: true, new: true });
  }
  return { state: { creds, keys }, saveCreds };
}

// ---------- Telegram (optional) ----------
const tgBot = TELEGRAM_TOKEN && TELEGRAM_ADMIN_ID
  ? new TelegramBot(TELEGRAM_TOKEN, { polling: false })
  : null;

(async () => {
  if (tgBot) {
    try {
      await tgBot.sendMessage(TELEGRAM_ADMIN_ID, "🚀 Nexos WhatsApp bot started. QR will arrive here.");
      logger.info("📨 Sent startup test message to Telegram admin.");
    } catch (err) {
      logger.error({ err }, "❌ Failed to send startup test message to Telegram");
    }
  } else {
    logger.warn("ℹ️ Telegram not configured (missing TELEGRAM_TOKEN/TELEGRAM_ADMIN_ID).");
  }
})();

// ---------- Express ----------
const app = express();
// لوج يثبت وصول البينغ من GitHub Actions/UptimeRobot
app.use((req, _res, next) => {
  if (req.path === "/healthz") {
    logger.info({ ua: req.headers["user-agent"] }, "🔁 /healthz ping");
  }
  next();
});
app.get("/", (_req, res) => res.send("WhatsApp Bot running"));
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => logger.info(`HTTP server running on port ${PORT}`));

// ---------- Start Bot ----------
async function startBot() {
  try {
    const { state, saveCreds } = await useMongoAuthState(logger);
    const hasCreds = !!state?.creds?.noiseKey;
    if (!hasCreds) logger.warn("⚠️ No session found. Will generate QR on first login.");

    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using Baileys v${version.join(".")} | latest: ${isLatest}`);

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: !tgBot,
      logger: pino({ level: "silent" }),
      browser: ["NexosBot", "Opera GX", "120.0.5543.204"],
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,

      // جَرّب إطفاء مزامنة التاريخ الآن لتقليل الضغط
      syncFullHistory: false,
      shouldSyncHistoryMessage: false,

      // مهلات و keep-alive أهدأ
      keepAliveIntervalMs: 60_000,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      emitOwnEvents: false,

      getMessage: async () => undefined,
    });

    // حفظ الاعتمادات عند التحديث
    sock.ev.on("creds.update", saveCreds);

    // هاندلر الاتصال (Backoff + QR للتليجرام)
    const connectionUpdateHandlerFactory = require("./events/connection.update")({
      logger,
      tgBot,
      adminId: TELEGRAM_ADMIN_ID,
      startBot,
      QRCode,
    });
    sock.ev.on("connection.update", connectionUpdateHandlerFactory(sock));

    // هاندلر الرسائل (أوامر + كلمات مفتاحية + رسالة افتراضية بالخاص)
    registerMessageHandlers(sock, logger);

  } catch (err) {
    logger.error({ err, stack: err?.stack }, "startBot fatal error");
    setTimeout(startBot, 5000);
  }
}

startBot();
