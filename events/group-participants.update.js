// events/group-participants.update.js
//
// ترحيب ووداع للأعضاء في القروبات + ذكر القوانين + (اختياري) رابط القروب + وصف القروب.
// - يجلب subject (اسم القروب) و desc (وصف القروب).
// - يحاول إظهار أسماء الأعضاء إن توفرت في جهات الاتصال؛ وإلا يظهر @الرقم.
// - إعدادات مرنة: قواعد ثابتة، أو من وصف القروب، أو مزيج.
//
// التوصيل من index.js:
//   const gpHandler = require("./events/group-participants.update")({ logger });
//   sock.ev.on("group-participants.update", gpHandler(sock));

/**
 * ✍️ إعدادات سريعة:
 * - تستطيع تخصيص كل قروب عبر مفتاح الـ JID. إن لم يوجد تخصيص، يُستخدم "default".
 * - لو ضبطت useGroupDescriptionAsRules = true سيؤخذ وصف القروب كقوانين (إن وجد).
 * - لو كان عندك قواعد ثابتة هنا وستستخدم الوصف أيضًا، ندمج الاثنين معًا.
 */
const GROUP_RULES = {
  default: {
    welcomeOn: true,                 // تفعيل الترحيب
    farewellOn: true,                // تفعيل الوداع
    useGroupDescriptionAsRules: true, // استخدم وصف القروب كقوانين (إن وُجد)
    rules: [
      "الرجاء الالتزام بالأدب العام وعدم إرسال السبام.",
      "المواضيع خارج الاهتمام تُرسل في أوقات محددة فقط.",
      "احترام آراء الآخرين والابتعاد عن الجدل الحاد.",
    ],
    link: "https://whatsapp.com/channel/0029VakGg7g1dAvzb2edgI05", // 🔗 عدّلها عند الحاجة (اختياري)
  },

  // مثال تخصيص قروب معيّن (اختياري):
  // "1203630XXXXXXXX@g.us": {
  //   welcomeOn: true,
  //   farewellOn: true,
  //   useGroupDescriptionAsRules: false,
  //   rules: [
  //     "قوانين خاصة بهذا القروب...",
  //   ],
  //   link: "https://chat.whatsapp.com/YYYYYYYYYYYYYYY",
  // },
};

// استخراج رقم الهاتف من JID (بدون اللاحقة)
function numberFromJid(jid = "") {
  return (jid.split("@")[0] || "").split(":")[0];
}

// تنسيق قائمة أسماء/منشنات بشكل جميل
function humanList(items, sep = "، ") {
  return items.join(sep);
}

// محاولة جلب اسم عرض لجهة اتصال من كاش Baileys إن توفر
function getDisplayName(sock, jid) {
  // ملاحظات:
  // - sock.contacts قد تحتوي: { [jid]: { name, verifiedName, notify, ... } }
  // - ليست مضمونة دائمًا، لذا نضع سقوط للمنشن @الرقم.
  const c = sock?.contacts?.[jid];
  const name =
    c?.name ||
    c?.verifiedName ||
    c?.notify ||
    null;
  return name || `@${numberFromJid(jid)}`;
}

// استخراج القوانين الفعلية بناءً على الإعدادات + وصف القروب
function buildRulesText({ cfg, groupDesc }) {
  const parts = [];

  // 1) من وصف القروب (إن مفعّل ومتوفر)
  if (cfg.useGroupDescriptionAsRules && groupDesc) {
    const cleaned = String(groupDesc).trim();
    if (cleaned) {
      parts.push(cleaned);
    }
  }

  // 2) القواعد الثابتة من الإعداد
  if (Array.isArray(cfg.rules) && cfg.rules.length) {
    const fixed = cfg.rules.map((r) => `• ${r}`).join("\n");
    parts.push(fixed);
  }

  if (!parts.length) return "— لا توجد قوانين محددة —";
  return parts.join("\n");
}

module.exports = ({ logger }) => (sock) => async (update) => {
  try {
    // { id: groupJid, participants: [jid1, ...], action: 'add'|'remove'|'promote'|'demote' }
    const { id: groupJid, participants = [], action } = update || {};
    if (!groupJid || !groupJid.endsWith("@g.us") || !participants.length) return;

    // إعداد القروب أو الافتراضي
    const cfg = GROUP_RULES[groupJid] || GROUP_RULES.default || {
      welcomeOn: true,
      farewellOn: true,
      useGroupDescriptionAsRules: true,
      rules: [],
      link: "",
    };

    // جلب ميتاداتا القروب: subject + desc
    let subject = "";
    let groupDesc = "";
    try {
      const meta = await sock.groupMetadata(groupJid);
      subject = meta?.subject || "";
      // في إصدارات بايليز: الوصف قد يكون meta?.desc أو meta?.desc?.toString()
      groupDesc = typeof meta?.desc === "string" ? meta.desc : (meta?.desc?.toString?.() || "");
    } catch (e) {
      logger.warn({ e }, "groupMetadata fetch failed");
    }

    // نجهّز mentions + أسماء العرض
    const mentions = participants;
    const names = participants.map((jid) => getDisplayName(sock, jid));
    const atList = participants.map((jid) => `@${numberFromJid(jid)}`);
    const namesText = humanList(names);
    const atText = humanList(atList);

    if (action === "add" && cfg.welcomeOn) {
      const rulesText = buildRulesText({ cfg, groupDesc });
      const linkLine = cfg.link ? `\n🔗 رابط القروب: ${cfg.link}` : "";

      const welcomeText = [
        `مرحبًا ${namesText}! 👋`,                        // أسماء إن توفرت
        subject ? `في قروب *${subject}*.` : "يا أهلاً وسهلاً.",
        "",
        "هذه بعض القوانين عندنا:",
        rulesText,
        linkLine,
      ].join("\n");

      await sock.sendMessage(groupJid, { text: welcomeText, mentions });
      return;
    }

    if (action === "remove" && cfg.farewellOn) {
      const byeText = `مع السلامة ${namesText} 👋\nنتمنّى لكم التوفيق.`;
      await sock.sendMessage(groupJid, { text: byeText, mentions });
      return;
    }

    // (اختياري) إشعارات الترقية/الخفض لاحقًا
    // if (action === "promote") { ... }
    // if (action === "demote")  { ... }

  } catch (err) {
    logger.error({ err, stack: err?.stack }, "group-participants.update handler error");
  }
};
