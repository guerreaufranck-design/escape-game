import { Progress } from "@/components/ui/progress";
import { Check } from "lucide-react";

interface CompletedStep {
  title: string;
  timeSeconds: number;
}

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  completedSteps: CompletedStep[];
}

export function StepProgress({
  currentStep,
  totalSteps,
  completedSteps,
}: StepProgressProps) {
  const progressPercent =
    totalSteps > 0 ? (completedSteps.length / totalSteps) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Progression</span>
        <span className="font-medium text-emerald-300">
          {completedSteps.length}/{totalSteps}
        </span>
      </div>

      <Progress
        value={progressPercent}
        className="h-2 bg-gray-800 [&>div]:bg-emerald-500"
      />

      <div className="flex items-center justify-between gap-1">
        {Array.from({ length: totalSteps }, (_, i) => {
          const stepNum = i + 1;
          const isCompleted = stepNum < currentStep;
          const isCurrent = stepNum === currentStep;

          return (
            <div key={stepNum} className="flex flex-col items-center gap-1">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
                  isCompleted
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : isCurrent
                      ? "animate-pulse border-emerald-400 bg-emerald-950 text-emerald-300"
                      : "border-gray-700 bg-gray-900 text-gray-600"
                }`}
              >
                {isCompleted ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  stepNum
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
