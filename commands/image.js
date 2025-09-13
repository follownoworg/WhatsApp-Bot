const sharp = require("sharp");
const { URL } = require("url");

// تنظيف الرابط من أقواس وزوائد
function cleanUrl(u) {
  return (u || "")
    .trim()
    .replace(/^<+|>+$/g, "")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ");
}

// تحويل رابط نسبي إلى مطلق
function toAbsoluteUrl(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

// استخراج og:image / twitter:image من HTML (بـ regex خفيف)
function extractOgImage(html) {
  const metas = [];
  const re = /<meta\s+[^>]*?(property|name)\s*=\s*["']([^"']+)["'][^>]*?(content)\s*=\s*["']([^"']+)["'][^>]*?>/gi;
  let m;
  while ((m = re.exec(html))) {
    const key = (m[2] || "").toLowerCase();
    const value = m[4] || "";
    metas.push({ key, value });
  }
  // تفضيل og:image ثم twitter:image
  const og = metas.find(x => x.key === "og:image") || metas.find(x => x.key === "twitter:image");
  return og ? og.value : null;
}

async function fetchWithUA(url, opts = {}) {
  const headers = Object.assign(
    {
      // UA يشبه كروم لتفادي صفحات خفيفة أو حظر بسيط
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "ar,en;q=0.9",
      "Referer": url,
    },
    opts.headers || {}
  );
  return fetch(url, { redirect: "follow", ...opts, headers });
}

module.exports = {
  name: "!صورة",
  aliases: ["صورة", "image", "!img", "img"],
  run: async ({ sock, msg, args, logger }) => {
    const chatId = msg.key.remoteJid;
    const raw = (args || []).join(" ");
    const inputUrl = cleanUrl(raw);

    if (!inputUrl || !/^https?:\/\//i.test(inputUrl)) {
      return sock.sendMessage(
        chatId,
        { text: "⚠️ الصيغة الصحيحة: `!صورة <رابط_الصورة>` (يجب أن يبدأ بـ http أو https)" },
        { quoted: msg }
      );
    }

    let finalImageUrl = null;

    try {
      // 1) حمّل الرابط الأولي
      const res = await fetchWithUA(inputUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();

      if (ct.startsWith("image/")) {
        // حالة صورة مباشرة
        finalImageUrl = inputUrl;
        const ab = await res.arrayBuffer();
        let buf = Buffer.from(ab);
        try {
          buf = await sharp(buf).rotate().jpeg({ quality: 85 }).toBuffer();
        } catch (e1) {
          logger && logger.warn({ e1, contentType: ct }, "JPEG convert failed, trying PNG");
          buf = await sharp(buf).rotate().png().toBuffer();
        }
        await sock.sendMessage(chatId, { image: buf, caption: "🖼️ هذه هي الصورة المطلوبة" }, { quoted: msg });
        return;
      }

      if (ct.includes("text/html")) {
        // 2) صفحة HTML — حاول استخراج og:image
        const html = await res.text();
        let og = extractOgImage(html);

        if (!og) {
          // أحياناً og:image في وسم meta مختلف أو عبر script؛
          // هنا نحاول بسيطًا: البحث عن og:image:url
          const reAlt = /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i;
          const m = html.match(reAlt);
          if (m) og = m[1];
        }

        if (!og) {
          throw new Error("لم نعثر على og:image في الصفحة.");
        }

        const absolute = toAbsoluteUrl(res.url, og); // res.url بعد التتبّع
        if (!absolute) throw new Error("فشل تحويل رابط og:image إلى مطلق.");

        // 3) حمّل رابط الصورة الحقيقي
        const res2 = await fetchWithUA(absolute);
        if (!res2.ok) {
          throw new Error(`HTTP ${res2.status} ${res2.statusText} (og:image)`);
        }
        const ct2 = (res2.headers.get("content-type") || "").toLowerCase();
        if (!ct2.startsWith("image/")) {
          throw new Error(`og:image ليست صورة مباشرة. content-type: ${ct2}`);
        }

        finalImageUrl = absolute;

        const ab2 = await res2.arrayBuffer();
        let buf2 = Buffer.from(ab2);
        try {
          buf2 = await sharp(buf2).rotate().jpeg({ quality: 85 }).toBuffer();
        } catch (e2) {
          logger && logger.warn({ e2, contentType: ct2 }, "JPEG convert failed on og:image, trying PNG");
          buf2 = await sharp(buf2).rotate().png().toBuffer();
        }

        await sock.sendMessage(chatId, { image: buf2, caption: "🖼️ هذه هي الصورة المطلوبة" }, { quoted: msg });
        return;
      }

      // 4) أنواع أخرى غير مدعومة
      throw new Error(`نوع غير مدعوم: ${ct || "unknown"}`);
    } catch (err) {
      logger && logger.error({ err, url: inputUrl, finalImageUrl }, "image command error");
      // رسائل توضيحية حسب الحالات الشائعة
      const msgText = [
        "❌ لم أتمكن من تحميل الصورة.",
        "",
        "أسباب محتملة:",
        "- الرابط ليس صورة مباشرة (صفحة مشاركة فيسبوك/جوجل).",
        "- الموقع يمنع التحميل المباشر (hotlinking).",
        "- الصورة خاصة/تحتاج تسجيل دخول.",
        "",
        "جرّب أحد الحلول:",
        "• أرسل رابطًا مباشرًا لملف الصورة (png/jpg/webp).",
        "• أو أرسل رابطًا لصفحة عامة فيها og:image صالح.",
        "• أو ارفع الصورة في خدمة استضافة صور عامة (ImgBB, Imgur, GitHub raw) ثم أعد المحاولة.",
      ].join("\n");
      await sock.sendMessage(chatId, { text: msgText }, { quoted: msg });
    }
  }
};
