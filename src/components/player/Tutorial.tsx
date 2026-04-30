"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { tt } from "@/lib/translations";
import {
  MapPin,
  Navigation,
  BookOpen,
  Lightbulb,
  Trophy,
  Shield,
  ChevronRight,
  ChevronLeft,
  Clock,
  Sparkles,
  ScanLine,
  Volume2,
} from "lucide-react";

interface TutorialProps {
  locale: Locale;
  gameTitle: string;
  totalSteps: number;
  estimatedDuration?: string;
  onComplete: () => void;
}

type Slide = {
  icon: React.ReactNode;
  titleKey: string;
  textKey: string;
  color: string;
};

const SLIDES: Slide[] = [
  { titleKey: "tutorial.s1.title",  textKey: "tutorial.s1.text",  color: "text-emerald-400", icon: <Clock     className="h-10 w-10" /> },
  { titleKey: "tutorial.s2.title",  textKey: "tutorial.s2.text",  color: "text-fuchsia-400", icon: <Sparkles  className="h-10 w-10" /> },
  { titleKey: "tutorial.s3.title",  textKey: "tutorial.s3.text",  color: "text-emerald-400", icon: <MapPin    className="h-10 w-10" /> },
  { titleKey: "tutorial.s4.title",  textKey: "tutorial.s4.text",  color: "text-emerald-400", icon: <Navigation className="h-10 w-10" /> },
  { titleKey: "tutorial.s5.title",  textKey: "tutorial.s5.text",  color: "text-fuchsia-400", icon: <Sparkles  className="h-10 w-10" /> },
  { titleKey: "tutorial.s6.title",  textKey: "tutorial.s6.text",  color: "text-amber-400",   icon: <ScanLine  className="h-10 w-10" /> },
  { titleKey: "tutorial.s7.title",  textKey: "tutorial.s7.text",  color: "text-violet-400",  icon: <Volume2   className="h-10 w-10" /> },
  { titleKey: "tutorial.s8.title",  textKey: "tutorial.s8.text",  color: "text-emerald-400", icon: <BookOpen  className="h-10 w-10" /> },
  { titleKey: "tutorial.s9.title",  textKey: "tutorial.s9.text",  color: "text-yellow-400",  icon: <Lightbulb className="h-10 w-10" /> },
  { titleKey: "tutorial.s10.title", textKey: "tutorial.s10.text", color: "text-yellow-400",  icon: <Trophy    className="h-10 w-10" /> },
  { titleKey: "tutorial.s11.title", textKey: "tutorial.s11.text", color: "text-blue-400",    icon: <Shield    className="h-10 w-10" /> },
];

export function Tutorial({
  locale,
  gameTitle,
  totalSteps,
  estimatedDuration,
  onComplete,
}: TutorialProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slide = SLIDES[currentSlide];
  const isLast = currentSlide === SLIDES.length - 1;

  // Slide 1 ({duration}) and slide 5 ({arButton}) interpolate runtime values
  // into the translated text. Keeping the substitution here avoids polluting
  // translations.ts with per-game variants.
  const renderSlideText = (key: string): string => {
    const raw = tt(key, locale);
    if (key === "tutorial.s1.text") {
      return raw.replace("{duration}", estimatedDuration || "1h30 - 2h");
    }
    if (key === "tutorial.s5.text") {
      return raw.replace("{arButton}", tt("play.arMode", locale));
    }
    return raw;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="text-center pt-8 pb-4 px-4">
        <p className="text-sm text-slate-500">{tt("tutorial.welcome", locale)}</p>
        <h1 className="text-xl font-bold text-emerald-400 mt-1">{gameTitle}</h1>
        <p className="text-xs text-slate-500 mt-1">
          {totalSteps} {tt("tutorial.steps", locale)}
        </p>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full">
        <div className={`mb-6 ${slide.color}`}>{slide.icon}</div>
        <h2 className="text-lg font-bold text-center mb-3">{tt(slide.titleKey, locale)}</h2>
        <p className="text-sm text-slate-400 text-center leading-relaxed">
          {renderSlideText(slide.textKey)}
        </p>
      </div>

      {/* Navigation */}
      <div className="px-6 pb-8 max-w-md mx-auto w-full space-y-4">
        {/* Dots */}
        <div className="flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentSlide
                  ? "bg-emerald-400 w-6"
                  : i < currentSlide
                    ? "bg-emerald-800"
                    : "bg-slate-700"
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          {currentSlide > 0 && (
            <Button
              variant="outline"
              size="lg"
              className="border-slate-700"
              onClick={() => setCurrentSlide(currentSlide - 1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          {isLast ? (
            <Button
              size="lg"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-14 rounded-xl text-base"
              onClick={onComplete}
            >
              {tt("tutorial.startCta", locale)}
            </Button>
          ) : (
            <Button
              size="lg"
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 rounded-xl"
              onClick={() => setCurrentSlide(currentSlide + 1)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Skip tutorial */}
        {!isLast && (
          <button
            onClick={onComplete}
            className="w-full text-center text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            {tt("tutorial.skip", locale)}
          </button>
        )}
      </div>
    </div>
  );
}
