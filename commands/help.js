module.exports = {
  name: "!help",
  aliases: ["help"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    const text = [
      "🤖 *Nexos Bot Commands*",
      "",
      "!hi / hi — تحية",
      "!ping / ping — قياس الاستجابة",
      "!time / time — وقت الخادم",
      "!id / id — (موجود كـ fallback في الهاندلر العام)",
      "!echo / echo <نص> — (fallback) يكرر النص",
      "!help / help — هذه القائمة",
      "!image / image <url> — إرسال صورة من رابط",
      "!poll / poll سؤال | خيار1, خيار2 — إنشاء تصويت",
    ].join("\n");
    await sock.sendMessage(chatId, { text }, { quoted: msg });
  }
};
