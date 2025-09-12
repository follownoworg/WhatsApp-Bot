module.exports = {
  name: "!image",
  aliases: ["image", "!img", "img"],
  run: async ({ sock, msg, args }) => {
    const chatId = msg.key.remoteJid;
    const url = (args || []).join(" ").trim();
    if (!url) {
      return sock.sendMessage(chatId, { text: "استخدم: `!image <رابط_صورة>`" }, { quoted: msg });
    }
    // Baileys يدعم إرسال صورة عبر URL مباشرة في الإصدارات الحديثة
    await sock.sendMessage(
      chatId,
      { image: { url }, caption: "🖼️ الصورة المطلوبة" },
      { quoted: msg }
    );
  }
};
