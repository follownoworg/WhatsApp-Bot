module.exports = {
  name: "!time",
  aliases: ["time"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    await sock.sendMessage(chatId, { text: `🕒 Server Time: ${new Date().toLocaleString()}` }, { quoted: msg });
  }
};
