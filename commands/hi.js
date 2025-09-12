module.exports = {
  name: "!مرحبا",
  aliases: ["مرحبا", "hi", "!hi", "السلام عليكم"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    await sock.sendMessage(chatId, { text: "👋 أهلاً وسهلاً! أنا بوت واتساب الخاص بك." }, { quoted: msg });
  }
};
