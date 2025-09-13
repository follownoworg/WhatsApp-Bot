// commands/hi.js
module.exports = {
  name: "مرحبا",
  aliases: ["هلا", "اهلا", "أهلا", "أهلاً", "اهلاً", "السلام"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    const text = [
      "👋 أهلاً وسهلاً! أنا بوت واتساب تابع للمطوّر *بسام حميد*.",
      "كيف أقدر أساعدك؟ لو حاب تشوف الأوامر اكتب: *مساعدة*.",
    ].join("\n");
    await sock.sendMessage(chatId, { text }, { quoted: msg });
  },
};
