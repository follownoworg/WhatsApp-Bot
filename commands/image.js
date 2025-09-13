const sharp = require("sharp");

// تنظيف الرابط من الأقواس والزائد (أحيانًا واتساب يرسل <url> أو فراغات خاصة)
function cleanUrl(u) {
  return (u || "")
    .trim()
    .replace(/^<+|>+$/g, "")              // يشيل < >
    .replace(/\u200B/g, "")               // يشيل zero-width space
    .replace(/\s+/g, " ");                // توحيد الفراغات
}

module.exports = {
  name: "!صورة",
  aliases: ["صورة", "image", "!img", "img"],
  run: async ({ sock, msg, args, logger }) => {
    const chatId = msg.key.remoteJid;
    const raw = (args || []).join(" ");
    const url = cleanUrl(raw);

    if (!url || !/^https?:\/\//i.test(url)) {
      return sock.sendMessage(
        chatId,
        { text: "⚠️ الصيغة الصحيحة: `!صورة <رابط_الصورة>` (يجب أن يبدأ بـ http أو https)" },
        { quoted: msg }
      );
    }

    try {
      // 1) حمّل الصورة كـ ArrayBuffer
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const contentType = res.headers.get("content-type") || "";
      const ab = await res.arrayBuffer();
      let buf = Buffer.from(ab);

      // 2) بعض الصيغ (avif/webp) أو روابط لا تعلن content-type بشكل صحيح
      //    نحاول التحويل دائمًا إلى JPEG لزيادة التوافق (fallback إلى PNG عند الحاجة)
      try {
        buf = await sharp(buf).rotate().jpeg({ quality: 85 }).toBuffer();
      } catch (e1) {
        logger && logger.warn({ e1, contentType }, "JPEG convert failed, trying PNG");
        buf = await sharp(buf).rotate().png().toBuffer();
      }

      // 3) أرسل الصورة كـ Buffer
      await sock.sendMessage(
        chatId,
        { image: buf, caption: "🖼️ هذه هي الصورة المطلوبة" },
        { quoted: msg }
      );
    } catch (err) {
      logger && logger.error({ err, url }, "image command error");
      await sock.sendMessage(
        chatId,
        { text: "❌ لم أتمكن من تحميل الصورة. تأكد أن الرابط مباشر وقابل للوصول." },
        { quoted: msg }
      );
    }
  }
};
