module.exports = {
  name: "!poll",
  aliases: ["poll", "!polls", "polls"],
  run: async ({ sock, msg, args }) => {
    const chatId = msg.key.remoteJid;
    const raw = (args || []).join(" ");
    // صيغة بسيطة: سؤال | خيار1, خيار2, خيار3
    const [questionPart, optionsPart] = raw.split("|").map(s => (s || "").trim());
    if (!questionPart || !optionsPart) {
      return sock.sendMessage(
        chatId,
        { text: "استخدم: `!poll سؤال | خيار1, خيار2, خيار3`" },
        { quoted: msg }
      );
    }
    const options = optionsPart.split(",").map(s => s.trim()).filter(Boolean);
    if (options.length < 2) {
      return sock.sendMessage(chatId, { text: "رجاءً اكتب خيارين على الأقل." }, { quoted: msg });
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
