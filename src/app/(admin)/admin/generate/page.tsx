"use client";

import { useState } from "react";

interface PipelineResult {
  success: boolean;
  gameId?: string;
  steps?: number;
  durationSeconds?: number;
  researchDurationMs?: number;
  creationDurationMs?: number;
  error?: string;
  message?: string;
}

interface Stop {
  name: string;
  description: string;
}

export default function GenerateGamePage() {
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [theme, setTheme] = useState("");
  const [themeDescription, setThemeDescription] = useState("");
  const [narrative, setNarrative] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [duration, setDuration] = useState(90);
  const [stops, setStops] = useState<Stop[]>([
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [progress, setProgress] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const updateStop = (index: number, field: "name" | "description", value: string) => {
    const newStops = [...stops];
    newStops[index] = { ...newStops[index], [field]: value };
    setStops(newStops);
  };

  const addStop = () => {
    setStops([...stops, { name: "", description: "" }]);
  };

  const removeStop = (index: number) => {
    if (stops.length > 1) {
      setStops(stops.filter((_, i) => i !== index));
    }
  };

  const handleGenerate = async () => {
    if (!city || !country || !theme || !themeDescription || !narrative) {
      alert("Please fill in all required fields");
      return;
    }

    // Filter out empty stops
    const validStops = stops.filter((s) => s.name.trim() !== "");

    setIsGenerating(true);
    setResult(null);
    setElapsed(0);

    if (validStops.length > 0) {
      setProgress(`Researching ${validStops.length} predefined stops with Perplexity Deep Research...`);
    } else {
      setProgress("Discovering locations with Perplexity Deep Research...");
    }

    const startTime = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.round((Date.now() - startTime) / 1000);
      setElapsed(seconds);
      if (seconds > 30 && seconds < 240) {
        setProgress("Perplexity is analyzing historical sources and verifying facts...");
      } else if (seconds >= 240 && seconds < 360) {
        setProgress("Claude is creating immersive riddles and narrative...");
      } else if (seconds >= 360) {
        setProgress("Inserting game into database...");
      }
    }, 1000);

    try {
      const body: Record<string, unknown> = {
        city,
        country,
        theme,
        themeDescription,
        narrative,
        difficulty,
        estimatedDurationMin: duration,
      };

      if (validStops.length > 0) {
        body.stops = validStops;
      }

      const response = await fetch("/api/generate-game", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_GENERATE_API_SECRET || ""}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      });
    } finally {
      clearInterval(timer);
      setIsGenerating(false);
      setProgress("");
    }
  };

  const inputClass =
    "w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none";

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">Game Generator</h1>
      <p className="text-gray-400 mb-8">
        Perplexity Deep Research + Claude Sonnet + Supabase
      </p>

      <div className="space-y-6">
        {/* City & Country */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">City *</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Toledo"
              className={inputClass}
              disabled={isGenerating}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Country *</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Spain"
              className={inputClass}
              disabled={isGenerating}
            />
          </div>
        </div>

        {/* Theme */}
        <div>
          <label className="block text-sm font-medium mb-1">Theme *</label>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="The Three Cultures"
            className={inputClass}
            disabled={isGenerating}
          />
        </div>

        {/* Theme Description */}
        <div>
          <label className="block text-sm font-medium mb-1">Description *</label>
          <textarea
            value={themeDescription}
            onChange={(e) => setThemeDescription(e.target.value)}
            placeholder="Explore how Christians, Muslims and Jews coexisted in medieval Toledo..."
            className={`${inputClass} h-20 resize-none`}
            disabled={isGenerating}
          />
        </div>

        {/* Narrative */}
        <div>
          <label className="block text-sm font-medium mb-1">Player Narrative *</label>
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="The player is a medieval scholar who discovers a hidden manuscript..."
            className={`${inputClass} h-20 resize-none`}
            disabled={isGenerating}
          />
        </div>

        {/* Difficulty & Duration */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
              className={inputClass}
              disabled={isGenerating}
            >
              <option value={1}>1 - Easy</option>
              <option value={2}>2 - Medium-Easy</option>
              <option value={3}>3 - Medium</option>
              <option value={4}>4 - Medium-Hard</option>
              <option value={5}>5 - Hard</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Duration (min)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={inputClass}
              disabled={isGenerating}
            />
          </div>
        </div>

        {/* Predefined Stops */}
        <div className="border border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-lg">Circuit Stops</h3>
              <p className="text-sm text-gray-400">
                Define the stops from oddballtrip. Leave empty for auto-discovery.
              </p>
            </div>
            <button
              onClick={addStop}
              disabled={isGenerating}
              className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              + Add stop
            </button>
          </div>

          <div className="space-y-3">
            {stops.map((stop, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className="text-gray-500 font-mono text-sm mt-2 w-6">
                  {i + 1}.
                </span>
                <input
                  type="text"
                  value={stop.name}
                  onChange={(e) => updateStop(i, "name", e.target.value)}
                  placeholder="Monument name (e.g., Mezquita Cristo de la Luz)"
                  className={`${inputClass} flex-1`}
                  disabled={isGenerating}
                />
                <input
                  type="text"
                  value={stop.description}
                  onChange={(e) => updateStop(i, "description", e.target.value)}
                  placeholder="Brief note (optional)"
                  className={`${inputClass} w-64`}
                  disabled={isGenerating}
                />
                <button
                  onClick={() => removeStop(i)}
                  disabled={isGenerating || stops.length <= 1}
                  className="text-gray-500 hover:text-red-400 mt-2 transition"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={`w-full py-4 rounded-lg font-bold text-lg transition-all ${
            isGenerating
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white"
          }`}
        >
          {isGenerating ? "Generating..." : "Generate Game"}
        </button>

        {/* Progress */}
        {isGenerating && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="animate-spin h-5 w-5 border-2 border-purple-500 border-t-transparent rounded-full" />
              <span className="text-purple-400 font-medium">
                {Math.floor(elapsed / 60)}:
                {String(elapsed % 60).padStart(2, "0")} elapsed
              </span>
            </div>
            <p className="text-gray-300 text-sm">{progress}</p>
            <div className="mt-3 bg-gray-900 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-1000"
                style={{ width: `${Math.min((elapsed / 420) * 100, 95)}%` }}
              />
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            className={`border rounded-lg p-5 ${
              result.success
                ? "bg-green-900/30 border-green-700"
                : "bg-red-900/30 border-red-700"
            }`}
          >
            {result.success ? (
              <>
                <h3 className="text-green-400 font-bold text-lg mb-3">
                  Game Created Successfully!
                </h3>
                <div className="space-y-1 text-gray-300">
                  <p><strong>Game ID:</strong> <code className="text-sm bg-gray-800 px-2 py-0.5 rounded">{result.gameId}</code></p>
                  <p><strong>Steps:</strong> {result.steps}</p>
                  <p><strong>Total time:</strong> {result.durationSeconds}s</p>
                  {result.researchDurationMs && (
                    <p className="text-sm text-gray-400">
                      Research: {Math.round(result.researchDurationMs / 1000)}s |
                      Creation: {Math.round((result.creationDurationMs || 0) / 1000)}s
                    </p>
                  )}
                </div>
                <p className="text-gray-400 text-sm mt-3">
                  The game is unpublished. Go to Jeux to review and publish it.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-red-400 font-bold text-lg mb-2">
                  Generation Failed
                </h3>
                <p className="text-gray-300">{result.error}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
