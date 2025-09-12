module.exports = {
  name: "!اختبار",
  aliases: ["اختبار", "ping", "!ping"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    const ts = (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000;
    const latency = Date.now() - ts;
    await sock.sendMessage(
      chatId,
      { text: `🏓 اختبار الاستجابة: ~${latency >= 0 ? latency : 0} مللي ثانية` },
      { quoted: msg }
    );
  }
};
