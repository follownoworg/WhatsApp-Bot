module.exports = {
  name: "!ping",
  aliases: ["ping"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    const ts = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
    const latency = Date.now() - ts;
    await sock.sendMessage(chatId, { text: `🏓 Pong! ~${latency >= 0 ? latency : 0}ms` }, { quoted: msg });
  }
};
