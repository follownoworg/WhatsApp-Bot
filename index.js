/**
 * WhatsApp Bot Entry Point
 * - Full MongoDB auth state for Baileys (creds + signal keys)
 * - Express health server (+ log pings incl. HEAD for UptimeRobot)
 * - Telegram QR delivery + Telegram admin commands (/ignore, /allow, /ignores)
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

// ✅ الهاندلر
const registerMessageHandlers = require("./handlers/messages");
// ✅ موديل التجاهل
const IgnoreChat = require("./models/IgnoreChat");

// ---------- Config ----------
const {
  TELEGRAM_TOKEN,
  TELEGRAM_ADMIN_ID, // numeric chat id
  PORT = 3000,
  LOG_LEVEL = "info",
} = process.env;

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

// ---------- Baileys auth (creds + signal keys في Mongo) ----------
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

// ---------- Telegram (Polling واحد + تنظيف Webhook) ----------
let tgBot = null;
(async () => {
  if (TELEGRAM_TOKEN && TELEGRAM_ADMIN_ID) {
    try {
      // أنشئ البوت بدون polling أولاً
      tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

      // امنع التكرار عبر حارس عالمي
      if (!global.__tgPollingStarted) {
        // احذف أي Webhook سابق + تجاهل رسائل الانتظار
        try {
          await tgBot.deleteWebHook({ drop_pending_updates: true });
        } catch (e) {
          logger.warn({ e }, "Telegram deleteWebHook warn");
        }

        // ابدأ polling الآن (نسخة واحدة فقط)
        await tgBot.startPolling({ restart: true, interval: 300, timeout: 30 });
        global.__tgPollingStarted = true;
        logger.info("📬 Telegram polling started.");
      } else {
        logger.warn("ℹ️ Telegram polling already started (skipping).");
      }

      tgBot.on("polling_error", (err) => {
        // 409 = تزامن مؤقت عند إعادة التشغيل؛ سجّلها كمعلومة وتجاهل
        if (String(err?.message || "").includes("409")) {
          return logger.info("ℹ️ Telegram 409 detected (old instance overlap). Ignoring.");
        }
        logger.warn({ err }, "Telegram polling error");
      });

      // رسالة بدء
      try {
        await tgBot.sendMessage(TELEGRAM_ADMIN_ID, "🚀 Nexos WhatsApp bot started. Admin commands ready.");
      } catch (e) {
        logger.warn({ e }, "Telegram startup DM warn");
      }
    } catch (err) {
      logger.error({ err }, "Telegram init error");
    }
  } else {
    logger.warn("ℹ️ Telegram not configured (missing TELEGRAM_TOKEN/TELEGRAM_ADMIN_ID).");
  }
})();

// ---------- Helpers ----------
function parseTarget(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (s.includes("@")) {
    const digits = s.replace(/\D+/g, "");
    return { jid: s, digits, isGroup: s.endsWith("@g.us") };
  }
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  return { jid: `${digits}@s.whatsapp.net`, digits, isGroup: false };
}

// ---------- أوامر تيليجرام الإدارية ----------
if (tgBot) {
  const onlyAdmin = (msg) => String(msg.chat?.id) === String(TELEGRAM_ADMIN_ID);

  tgBot.onText(/^\/ignore\s+(.+)$/i, async (msg, match) => {
    if (!onlyAdmin(msg)) return;
    const info = parseTarget(match[1]);
    if (!info?.jid) return tgBot.sendMessage(msg.chat.id, "❌ رقم/معرّف غير صالح.");

    try {
      await IgnoreChat.updateOne(
        { chatId: info.jid },
        { $set: { chatId: info.jid, addedBy: "telegram-admin" } },
        { upsert: true }
      );
      await tgBot.sendMessage(msg.chat.id, `✅ تم تجاهل: \`${info.jid}\``, { parse_mode: "Markdown" });
    } catch (e) {
      logger.error({ e }, "ignore via telegram failed");
      await tgBot.sendMessage(msg.chat.id, "❌ فشل تنفيذ التجاهل.");
    }
  });

  tgBot.onText(/^\/(?:allow|unignore)\s+(.+)$/i, async (msg, match) => {
    if (!onlyAdmin(msg)) return;
    const info = parseTarget(match[1]);
    if (!info?.jid) return tgBot.sendMessage(msg.chat.id, "❌ رقم/معرّف غير صالح.");

    try {
      // حذف بالمطابقة التامة…
      const r1 = await IgnoreChat.deleteOne({ chatId: info.jid });
      // …وأيضًا حذف أي إدخالات بنفس الأرقام تحسبًا لاختلاف الصيغة
      const digitRegex = info.digits ? new RegExp(`^${info.digits}@`) : null;
      const r2 = digitRegex ? await IgnoreChat.deleteMany({ chatId: { $regex: digitRegex } }) : { deletedCount: 0 };

      const total = (r1.deletedCount || 0) + (r2.deletedCount || 0);
      if (total > 0) {
        await tgBot.sendMessage(msg.chat.id, `✅ أُلغي التجاهل عن: \`${info.jid}\` (حُذِف ${total})`, {
          parse_mode: "Markdown",
        });
      } else {
        await tgBot.sendMessage(
          msg.chat.id,
          "ℹ️ هذه المحادثة ليست في قائمة التجاهل. استخدم /ignores لاستعراض القائمة."
        );
      }
    } catch (e) {
      logger.error({ e }, "allow via telegram failed");
      await tgBot.sendMessage(msg.chat.id, "❌ فشل إلغاء التجاهل.");
    }
  });

  tgBot.onText(/^\/ignores$/i, async (msg) => {
    if (!onlyAdmin(msg)) return;
    try {
      const rows = await IgnoreChat.find({}).sort({ createdAt: -1 }).limit(100).lean();
      if (!rows.length) {
        return tgBot.sendMessage(msg.chat.id, "📭 لا توجد محادثات متجاهلة.");
      }
      const body = rows
        .map((r, i) => `${i + 1}. \`${r.chatId}\` — ${new Date(r.createdAt).toLocaleString("ar-YE")}`)
        .join("\n");
      await tgBot.sendMessage(msg.chat.id, `📝 *قائمة التجاهل*\n\n${body}`, { parse_mode: "Markdown" });
    } catch (e) {
      logger.error({ e }, "list ignores via telegram failed");
      await tgBot.sendMessage(msg.chat.id, "❌ فشل جلب القائمة.");
    }
  });
}

// ---------- Express ----------
const app = express();

// لوج واضح لطلبات UptimeRobot على /healthz (HEAD/GET)
app.use((req, _res, next) => {
  if (req.path === "/healthz") {
    logger.info(
      { ua: req.headers["user-agent"], method: req.method },
      "🔁 /healthz ping"
    );
  }
  next();
});

// الجذر (اختياري) — لو أردت أيضًا مراقب للجذر
app.get("/", (_req, res) => res.send("WhatsApp Bot running"));

// ✅ صحيّة تدعم GET و HEAD صراحة (UptimeRobot يستخدم HEAD غالبًا)
app.all("/healthz", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method === "HEAD") {
    return res.status(200).end(); // 200 بدون جسم
  }
  res.type("text/plain").send("OK");
});

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

      browser: ["Chrome", "Linux", "121.0.0.0"],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,

      // استقرار أولاً
      syncFullHistory: false,
      shouldSyncHistoryMessage: false,

      keepAliveIntervalMs: 20_000,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,

      emitOwnEvents: false,
      getMessage: async () => undefined,
    });

    sock.ev.on("creds.update", saveCreds);

    const connectionUpdateHandlerFactory = require("./events/connection.update")({
      logger,
      tgBot,
      adminId: TELEGRAM_ADMIN_ID,
      startBot,
      QRCode,
    });
    sock.ev.on("connection.update", connectionUpdateHandlerFactory(sock));

    registerMessageHandlers(sock, logger);
  } catch (err) {
    logger.error({ err, stack: err?.stack }, "startBot fatal error");
    setTimeout(startBot, 5000);
  }
}

startBot();
