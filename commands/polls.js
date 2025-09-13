module.exports = {
  name: "!تصويت",
  aliases: ["تصويت", "poll", "!polls", "polls"],
  run: async ({ sock, msg, args }) => {
    const chatId = msg.key.remoteJid;
    const raw = (args || []).join(" ");

    // صيغة: سؤال | خيار1, خيار2, خيار3
    const [questionPart, optionsPart] = raw.split("|").map(s => (s || "").trim());

    if (!questionPart || !optionsPart) {
      return sock.sendMessage(
        chatId,
        { text: "⚠️ الصيغة الصحيحة: `!تصويت ما هو أفضل لون؟ | أحمر, أزرق, أخضر`" },
        { quoted: msg }
      );
    }

    // نظّف الخيارات وقيّد العدد (واتساب يقبل عددًا محدودًا؛ نخليه 12 كحد معقول)
    let values = optionsPart
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    if (values.length < 2) {
      return sock.sendMessage(chatId, { text: "⚠️ يجب كتابة خيارين على الأقل." }, { quoted: msg });
    }
    if (values.length > 12) {
      values = values.slice(0, 12);
    }

    // إرسال التصويت وفق صيغة Baileys الحديثة: poll.name + poll.values
    await sock.sendMessage(
      chatId,
      {
        poll: {
          name: questionPart,
          values,
          selectableCount: 1, // اختيار واحد — غيّره لـ 2+ لو تريد متعدد
        },
      },
      { quoted: msg }
    );
  }
};
