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

    const options = optionsPart.split(",").map(s => s.trim()).filter(Boolean);
    if (options.length < 2) {
      return sock.sendMessage(chatId, { text: "⚠️ يجب كتابة خيارين على الأقل." }, { quoted: msg });
    }

    await sock.sendMessage(
      chatId,
      {
        poll: {
          name: questionPart,
          options: options.map(o => ({ optionName: o })),
          selectableCount: 1, // اختيار واحد
        },
      },
      { quoted: msg }
    );
  }
};
