import Image from "next/image";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin } from "lucide-react";

interface StepCardProps {
  title: string;
  riddleText: string;
  riddleImage?: string | null;
  stepOrder: number;
  totalSteps: number;
}

export function StepCard({
  title,
  riddleText,
  riddleImage,
  stepOrder,
  totalSteps,
}: StepCardProps) {
  return (
    <Card className="border-emerald-900/50 bg-gray-950/80 shadow-xl shadow-emerald-900/10 backdrop-blur-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className="border-emerald-700/50 bg-emerald-950/50 text-emerald-300"
          >
            <MapPin className="mr-1 h-3 w-3" />
            Etape {stepOrder}/{totalSteps}
          </Badge>
        </div>
        <CardTitle className="text-xl font-bold tracking-tight text-emerald-50">
          {title}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {riddleImage && (
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-emerald-900/30">
            <Image
              src={riddleImage}
              alt="Indice visuel"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 500px"
            />
          </div>
        )}

        <div className="rounded-lg border border-emerald-900/30 bg-emerald-950/20 p-4">
          <p className="whitespace-pre-line text-base leading-relaxed text-gray-200 italic">
            {riddleText}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
