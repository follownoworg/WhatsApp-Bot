/**
 * WhatsApp Bot Entry Point with MongoDB session storage
 */
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const mongoose = require("mongoose");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const config = require("./utils");

// Logging setup (كما كان)
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
const logger = pino({ level: config.logging?.level || "info", transport: { target: "pino-pretty" } }, pino.destination(logFile));

// Connect MongoDB
mongoose.connect(process.env.MONGODB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const SessionSchema = new mongoose.Schema({ id: String, data: String });
const Session = mongoose.model("Session", SessionSchema);

// Encrypt/Decrypt functions using SESSION_SECRET
function encrypt(text) {
  const cipher = crypto.createCipher("aes-256-ctr", process.env.SESSION_SECRET);
  let crypted = cipher.update(text, "utf8", "hex");
  crypted += cipher.final("hex");
  return crypted;
}
function decrypt(text) {
  const decipher = crypto.createDecipher("aes-256-ctr", process.env.SESSION_SECRET);
  let dec = decipher.update(text, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// Load commands
const commands = new Map();
fs.readdirSync("./commands").forEach((file) => {
  const cmd = require(`./commands/${file}`);
  commands.set(cmd.name, cmd);
});

// Load event handlers
const eventFiles = fs.readdirSync("./events").filter(f => f.endsWith(".js"));
const eventHandlers = [];
for (const file of eventFiles) {
  const eventModule = require(`./events/${file}`);
  if (eventModule.eventName && typeof eventModule.handler === "function") {
    eventHandlers.push(eventModule);
  }
}

async function startBot() {
  // Load session from MongoDB
  let state;
  const dbSession = await Session.findOne({ id: "session" });
  if (dbSession) {
    state = JSON.parse(decrypt(dbSession.data));
    logger.info("✅ Loaded session from MongoDB");
  }

  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Using Baileys v${version.join(".")}, Latest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    auth: state || undefined,
    printQRInTerminal: true, // يظهر QR للمرة الأولى إذا لم توجد جلسة
    logger: pino({ level: 'silent' }),
    browser: ["NexosBot", "Opera GX", "120.0.5543.204"],
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: config.bot?.online || true,
    syncFullHistory: config.bot?.history || false,
    shouldSyncHistoryMessage: config.bot?.history || false,
  });

  // Save login credentials to MongoDB on update
  sock.ev.on("creds.update", async (authState) => {
    const encrypted = encrypt(JSON.stringify(authState));
    await Session.findOneAndUpdate(
      { id: "session" },
      { data: encrypted },
      { upsert: true }
    );
    logger.info("✅ Session saved/updated in MongoDB");
  });

  // Register event handlers
  for (const { eventName, handler } of eventHandlers) {
    if (eventName === "connection.update") {
      sock.ev.on(eventName, handler(sock, logger, startBot));
    } else if (eventName === "messages.upsert") {
      sock.ev.on(eventName, handler(sock, logger, commands));
    } else {
      sock.ev.on(eventName, handler(sock, logger));
    }
  }
}

startBot();
