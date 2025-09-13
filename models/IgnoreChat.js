// models/IgnoreChat.js
const mongoose = require("mongoose");

const ignoreChatSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true }, // مثال: 9677xxxxxxx@s.whatsapp.net أو xxxx@g.us
    addedBy: { type: String }, // مَن أضافه (اختياري)
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.models.IgnoreChat || mongoose.model("IgnoreChat", ignoreChatSchema);
