"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Language = "en" | "fr";

export function LanguageSelector({
  englishHref,
  frenchHref,
  language,
}: {
  englishHref: string;
  frenchHref: string;
  language: Language;
}) {
  const router = useRouter();
  const label = language === "fr" ? "Langue" : "Language";

  function selectLanguage(nextLanguage: string) {
    router.push(nextLanguage === "fr" ? frenchHref : englishHref);
  }

  return (
    <div className="mt-8 flex items-center gap-3">
      <Languages className="size-4 text-[#b3acf3]" />
      <span className="text-sm text-white/54">{label}</span>
      <Select value={language} onValueChange={selectLanguage}>
        <SelectTrigger
          aria-label={label}
          className="h-10 min-w-36 rounded-full border-white/12 bg-white/[0.05] px-4 text-white shadow-none hover:bg-white/[0.1]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          align="start"
          className="dark border border-white/12"
        >
          <SelectItem value="fr">Français</SelectItem>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
