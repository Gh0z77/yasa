// Uzbek (Latin): use ʻ (U+02BB) and ʼ (U+02BC), never the ASCII apostrophe; strings use double quotes.
import type { DictShape } from "../../types";
import type { code as en } from "../en/code";

export const code = {
  tree: {
    title: "Fayllar",
    search: "Fayllarni saralash…",
    newFile: "Yangi fayl",
    newFilePlaceholder: "src/components/Name.tsx",
    rename: "Nomini oʻzgartirish",
    delete: "Oʻchirish",
    noMatch: "Mos fayl topilmadi",
    toggle: "Fayllar roʻyxatini koʻrsatish yoki yashirish",
    exists: "Bunday nomli fayl allaqachon mavjud",
    created: "Fayl yaratildi",
    renamed: "Fayl nomi oʻzgartirildi",
    deleted: "Fayl oʻchirildi",
  },
  editor: {
    emptyTitle: "Faylni tanlang",
    emptyHint: "Kodni koʻrish yoki tahrirlash uchun chapdan faylni tanlang.",
    aiWriting: "AI yozmoqda…",
    aiWorking: "AI ishlamoqda — tahrirlash toʻxtatib turilgan",
    readOnly: "Faqat oʻqish uchun",
    binary: "Bu ikkilik fayl, uni bu yerda tahrirlab boʻlmaydi.",
    saving: "Saqlanmoqda…",
    saved: "Saqlandi",
    saveFailed: "Saqlab boʻlmadi",
    unsaved: "Saqlanmagan oʻzgarishlar",
    closeTab: "Varaqni yopish",
    problems: "Muammolar",
    lines: "{count} qator",
  },
} as const satisfies DictShape<typeof en>;
