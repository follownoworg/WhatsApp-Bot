module.exports = {
  name: "!الوقت",
  aliases: ["الوقت", "time", "!time"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    const now = new Date().toLocaleString("ar-EG", { timeZone: "Asia/Riyadh" }); // الوقت بالعربية
    await sock.sendMessage(chatId, { text: `🕒 الوقت الحالي: ${now}` }, { quoted: msg });
  }
};
