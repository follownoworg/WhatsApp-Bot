// commands/help.js
module.exports = {
  name: "مساعدة",
  aliases: ["قائمة", "تعليمات", "help"],
  run: async ({ sock, msg }) => {
    const chatId = msg.key.remoteJid;
    const text = [
      "🤖 *قائمة الأوامر*",
      "",
      "👋 مرحبا — ترحيب وتعريف سريع",
      "🏓 اختبار — قياس استجابة البوت",
      "🕒 الوقت — عرض الوقت الحالي (آسيا/عدن)",
      "🆔 المعرف — عرض معرفات المحادثة والمرسل",
      "📄 مساعدة — هذه القائمة",
      "",
      "ملاحظة: أنا بوت واتساب تابع للمطوّر *بسام حميد*. لو عندك استفسار برسّله له.",
    ].join("\n");
    await sock.sendMessage(chatId, { text }, { quoted: msg });
  },
};
