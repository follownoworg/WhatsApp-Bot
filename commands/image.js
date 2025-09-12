module.exports = {
  name: "!صورة",
  aliases: ["صورة", "image", "!img", "img"],
  run: async ({ sock, msg, args }) => {
    const chatId = msg.key.remoteJid;
    const url = (args || []).join(" ").trim();

    if (!url) {
      return sock.sendMessage(
        chatId,
        { text: "⚠️ الصيغة الصحيحة: `!صورة <رابط_الصورة>`" },
        { quoted: msg }
      );
    }

    try {
      await sock.sendMessage(
        chatId,
        { image: { url }, caption: "🖼️ هذه هي الصورة المطلوبة" },
        { quoted: msg }
      );
    } catch (err) {
      await sock.sendMessage(
        chatId,
        { text: "❌ لم أتمكن من تحميل الصورة. تأكد أن الرابط صحيح ومباشر." },
        { quoted: msg }
      );
    }
  }
};
