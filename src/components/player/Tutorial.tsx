"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import {
  MapPin,
  Navigation,
  BookOpen,
  Lightbulb,
  SkipForward,
  Trophy,
  Shield,
  ChevronRight,
  ChevronLeft,
  Clock,
  AlertTriangle,
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
  title: Record<Locale, string>;
  text: Record<Locale, string>;
  color: string;
};

const getSlides = (estimatedDuration?: string): Slide[] => [
  {
    icon: <Clock className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Avant de commencer",
      en: "Before you start",
      de: "Bevor Sie beginnen",
      es: "Antes de empezar",
      it: "Prima di iniziare",
    },
    text: {
      fr: `Duree estimee : ${estimatedDuration || "1h30 a 2h"} (sans compter le temps de retour au point de depart). Ce parcours se fait entierement a pied en exterieur. Attention : certains passages peuvent etre difficiles d'acces avec une poussette. Prevoyez de l'eau, de la creme solaire et de bonnes chaussures !`,
      en: `Estimated duration: ${estimatedDuration || "1h30 to 2h"} (not including walk back to the starting point). This route is entirely on foot outdoors. Note: some sections may be tricky with a stroller. Bring water, sunscreen and good shoes!`,
      de: `Geschatzte Dauer: ${estimatedDuration || "1h30 bis 2h"} (ohne Ruckweg zum Startpunkt). Diese Route findet komplett zu Fuss im Freien statt. Hinweis: Einige Abschnitte konnen mit einem Kinderwagen schwierig sein. Bringen Sie Wasser, Sonnencreme und gute Schuhe mit!`,
      es: `Duracion estimada: ${estimatedDuration || "1h30 a 2h"} (sin contar el tiempo de regreso al punto de partida). Este recorrido es totalmente a pie al aire libre. Nota: algunos tramos pueden ser complicados con cochecito de bebe. Lleva agua, proteccion solar y buen calzado!`,
      it: `Durata stimata: ${estimatedDuration || "1h30 a 2h"} (senza contare il ritorno al punto di partenza). Questo percorso e interamente a piedi all'aperto. Nota: alcuni tratti possono essere difficili con un passeggino. Portate acqua, crema solare e buone scarpe!`,
    },
  },
  {
    icon: <MapPin className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Comment ca marche ?",
      en: "How does it work?",
      de: "Wie funktioniert es?",
      es: "Como funciona?",
      it: "Come funziona?",
    },
    text: {
      fr: "A chaque etape, une enigme vous guide vers un lieu. Utilisez le GPS pour vous y rendre. Quand vous etes au bon endroit, cliquez \"Valider ma position\" pour debloquer l'etape suivante.",
      en: "At each step, a riddle guides you to a location. Use GPS to get there. When you're at the right spot, click \"Validate my position\" to unlock the next step.",
      de: "Bei jedem Schritt fuhrt Sie ein Ratsel zu einem Ort. Nutzen Sie GPS, um dorthin zu gelangen. Wenn Sie am richtigen Ort sind, klicken Sie auf \"Position bestatigen\".",
      es: "En cada etapa, un enigma te guia hacia un lugar. Usa el GPS para llegar. Cuando estes en el lugar correcto, pulsa \"Validar mi posicion\" para desbloquear la siguiente etapa.",
      it: "Ad ogni tappa, un enigma vi guida verso un luogo. Usate il GPS per raggiungerlo. Quando siete nel posto giusto, cliccate \"Valida la mia posizione\" per sbloccare la tappa successiva.",
    },
  },
  {
    icon: <Navigation className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "La boussole vous guide",
      en: "The compass guides you",
      de: "Der Kompass fuhrt Sie",
      es: "La brujula te guia",
      it: "La bussola vi guida",
    },
    text: {
      fr: "La fleche verte pointe toujours vers le haut de votre telephone. Tournez sur vous-meme : quand le \"N\" du cercle s'aligne avec la fleche, vous etes dans la bonne direction. La distance et le temps de marche se mettent a jour en temps reel.",
      en: "The green arrow always points to the top of your phone. Turn around: when the \"N\" on the circle aligns with the arrow, you're heading the right way. Distance and walking time update in real-time.",
      de: "Der grune Pfeil zeigt immer nach oben auf Ihrem Telefon. Drehen Sie sich: Wenn das \"N\" des Kreises mit dem Pfeil ubereinstimmt, gehen Sie in die richtige Richtung. Entfernung und Gehzeit werden in Echtzeit aktualisiert.",
      es: "La flecha verde siempre apunta hacia arriba en tu telefono. Gira sobre ti mismo: cuando la \"N\" del circulo se alinea con la flecha, vas en la direccion correcta. La distancia y el tiempo de caminata se actualizan en tiempo real.",
      it: "La freccia verde punta sempre verso l'alto del vostro telefono. Giratevi: quando la \"N\" del cerchio si allinea con la freccia, state andando nella direzione giusta. Distanza e tempo di camminata si aggiornano in tempo reale.",
    },
  },
  {
    icon: <BookOpen className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Notez vos reponses",
      en: "Write down your answers",
      de: "Notieren Sie Ihre Antworten",
      es: "Anota tus respuestas",
      it: "Annotate le vostre risposte",
    },
    text: {
      fr: "Chaque enigme vous donne une reponse a trouver : un chiffre, un mot ou une phrase. Notez-la dans votre carnet (icone livre en haut). A la fin du jeu, assemblez toutes vos reponses pour former le code final et valider votre victoire !",
      en: "Each riddle gives you an answer to find: a number, a word or a phrase. Note it in your notebook (book icon at top). At the end of the game, assemble all your answers to form the final code and validate your victory!",
      de: "Jedes Ratsel gibt Ihnen eine Antwort zum Finden: eine Zahl, ein Wort oder einen Satz. Notieren Sie sie in Ihrem Notizbuch (Buchsymbol oben). Am Ende des Spiels setzen Sie alle Antworten zum Endcode zusammen und bestatigen Ihren Sieg!",
      es: "Cada enigma te da una respuesta que encontrar: un numero, una palabra o una frase. Anotala en tu cuaderno (icono de libro arriba). Al final del juego, reune todas tus respuestas para formar el codigo final y validar tu victoria!",
      it: "Ogni enigma vi da una risposta da trovare: un numero, una parola o una frase. Annotatela nel vostro taccuino (icona libro in alto). Alla fine del gioco, assemblate tutte le risposte per formare il codice finale e convalidare la vostra vittoria!",
    },
  },
  {
    icon: <Lightbulb className="h-10 w-10" />,
    color: "text-yellow-400",
    title: {
      fr: "Indices et passage d'etape",
      en: "Hints and step skipping",
      de: "Hinweise und Schritte uberspringen",
      es: "Pistas y saltar etapas",
      it: "Indizi e salto delle tappe",
    },
    text: {
      fr: "Bloque ? Demandez un indice (+2 min de penalite, +10 min apres le 3e). Vraiment bloque ? Passez l'etape (+45 min) — la reponse vous sera revelee. Attention, chaque penalite impacte votre score au classement !",
      en: "Stuck? Ask for a hint (+2 min penalty, +10 min after the 3rd). Really stuck? Skip the step (+45 min) — the answer will be revealed. Warning: each penalty impacts your leaderboard score!",
      de: "Festgefahren? Fordern Sie einen Hinweis an (+2 Min. Strafe, +10 Min. nach dem 3.). Wirklich festgefahren? Uberspringen Sie den Schritt (+45 Min.) — die Antwort wird enthullt. Achtung: Jede Strafe beeinflusst Ihre Rangliste!",
      es: "Atascado? Pide una pista (+2 min de penalizacion, +10 min despues de la 3a). Muy atascado? Salta la etapa (+45 min) — la respuesta sera revelada. Atencion: cada penalizacion impacta tu clasificacion!",
      it: "Bloccati? Chiedete un indizio (+2 min di penalita, +10 min dopo il 3o). Molto bloccati? Saltate la tappa (+45 min) — la risposta vi sara rivelata. Attenzione: ogni penalita impatta la vostra classifica!",
    },
  },
  {
    icon: <Trophy className="h-10 w-10" />,
    color: "text-yellow-400",
    title: {
      fr: "Classement general",
      en: "General ranking",
      de: "Gesamtrangliste",
      es: "Clasificacion general",
      it: "Classifica generale",
    },
    text: {
      fr: "Les meilleurs temps remontent au classement general ! Moins de penalites et un temps rapide = meilleur score. A la fin, decouvrez votre rang parmi tous les joueurs et partagez votre resultat.",
      en: "The best times rise to the top of the general ranking! Fewer penalties and faster time = better score. At the end, discover your rank among all players and share your result.",
      de: "Die besten Zeiten steigen in der Gesamtrangliste auf! Weniger Strafen und schnellere Zeit = bessere Punktzahl. Am Ende entdecken Sie Ihren Rang unter allen Spielern und teilen Ihr Ergebnis.",
      es: "Los mejores tiempos suben en la clasificacion general! Menos penalizaciones y tiempo rapido = mejor puntuacion. Al final, descubre tu puesto entre todos los jugadores y comparte tu resultado.",
      it: "I migliori tempi salgono nella classifica generale! Meno penalita e tempo veloce = punteggio migliore. Alla fine, scoprite il vostro rango tra tutti i giocatori e condividete il vostro risultato.",
    },
  },
  {
    icon: <Shield className="h-10 w-10" />,
    color: "text-blue-400",
    title: {
      fr: "Conseils de securite",
      en: "Safety tips",
      de: "Sicherheitshinweise",
      es: "Consejos de seguridad",
      it: "Consigli di sicurezza",
    },
    text: {
      fr: "Restez sur les sentiers balises et soyez attentifs a la circulation. Ne traversez jamais en dehors des passages pietons. En cas d'urgence, composez le 112. Amusez-vous en toute securite !",
      en: "Stay on marked trails and watch for traffic. Never cross outside pedestrian crossings. In case of emergency, call 112. Have fun safely!",
      de: "Bleiben Sie auf markierten Wegen und achten Sie auf den Verkehr. Uberqueren Sie nie ausserhalb von Fusgangeruberwegen. Im Notfall rufen Sie 112 an. Viel Spass und bleiben Sie sicher!",
      es: "No abandones los senderos senalizados y presta atencion al trafico. Nunca cruces fuera de los pasos de peatones. En caso de emergencia, llama al 112. Diviertete con seguridad!",
      it: "Restate sui sentieri segnalati e fate attenzione al traffico. Non attraversate mai fuori dalle strisce pedonali. In caso di emergenza, chiamate il 112. Divertitevi in sicurezza!",
    },
  },
];

export function Tutorial({ locale, gameTitle, totalSteps, estimatedDuration, onComplete }: TutorialProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = getSlides(estimatedDuration);
  const slide = slides[currentSlide];
  const isLast = currentSlide === slides.length - 1;

  // Helper: fallback to en then fr for non-static locales (e.g. nl, pt, etc.)
  const l = (dict: Record<string, string>) => dict[locale] || dict.en || dict.fr || '';

  const welcomeTitle: Record<Locale, string> = {
    fr: "Bienvenue dans",
    en: "Welcome to",
    de: "Willkommen bei",
    es: "Bienvenido a",
    it: "Benvenuto in",
  };

  const stepsLabel: Record<Locale, string> = {
    fr: "etapes",
    en: "steps",
    de: "Schritte",
    es: "etapas",
    it: "tappe",
  };

  const startLabel: Record<Locale, string> = {
    fr: "C'est compris, on y va !",
    en: "Got it, let's go!",
    de: "Verstanden, los geht's!",
    es: "Entendido, vamos!",
    it: "Capito, andiamo!",
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="text-center pt-8 pb-4 px-4">
        <p className="text-sm text-slate-500">{l(welcomeTitle)}</p>
        <h1 className="text-xl font-bold text-emerald-400 mt-1">{gameTitle}</h1>
        <p className="text-xs text-slate-500 mt-1">{totalSteps} {l(stepsLabel)}</p>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full">
        <div className={`mb-6 ${slide.color}`}>
          {slide.icon}
        </div>
        <h2 className="text-lg font-bold text-center mb-3">
          {l(slide.title)}
        </h2>
        <p className="text-sm text-slate-400 text-center leading-relaxed">
          {l(slide.text)}
        </p>
      </div>

      {/* Navigation */}
      <div className="px-6 pb-8 max-w-md mx-auto w-full space-y-4">
        {/* Dots */}
        <div className="flex justify-center gap-2">
          {slides.map((_, i) => (
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
              {l(startLabel)}
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
            {l({ fr: "Passer le tutoriel", en: "Skip tutorial", de: "Tutorial uberspringen", es: "Saltar tutorial", it: "Salta il tutorial" })}
          </button>
        )}
      </div>
    </div>
  );
}
