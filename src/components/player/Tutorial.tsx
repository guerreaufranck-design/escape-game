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
  Camera,
  Sparkles,
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
      fr: "La carte DIVAN vous guide",
      en: "The DIVAN map guides you",
      de: "Die DIVAN-Karte fuhrt Sie",
      es: "El mapa DIVAN te guia",
      it: "La mappa DIVAN vi guida",
    },
    text: {
      fr: "Sur la carte, un grand cone vert entoure votre position et pointe automatiquement vers le prochain objectif. Une ligne en pointilles vous relie au point a atteindre avec la distance affichee en son milieu. Plus besoin de boussole : tout est calcule a partir du GPS et suit vos deplacements en temps reel.",
      en: "On the map, a large green cone wraps around your position and automatically points at the next objective. A dashed line connects you to the target with the distance shown in the middle. No compass needed: everything is computed from GPS and follows your movements in real time.",
      de: "Auf der Karte umgibt ein grosser gruner Kegel Ihre Position und zeigt automatisch auf das nachste Ziel. Eine gestrichelte Linie verbindet Sie mit dem Zielpunkt, in der Mitte wird die Entfernung angezeigt. Kein Kompass erforderlich: Alles wird aus dem GPS berechnet und folgt Ihren Bewegungen in Echtzeit.",
      es: "En el mapa, un gran cono verde rodea tu posicion y apunta automaticamente al proximo objetivo. Una linea de puntos te conecta con el punto a alcanzar con la distancia mostrada en el centro. Ya no necesitas brujula: todo se calcula a partir del GPS y sigue tus movimientos en tiempo real.",
      it: "Sulla mappa, un grande cono verde circonda la tua posizione e punta automaticamente al prossimo obiettivo. Una linea tratteggiata ti collega al punto da raggiungere con la distanza mostrata al centro. Non serve piu la bussola: tutto e calcolato dal GPS e segue i tuoi movimenti in tempo reale.",
    },
  },
  {
    icon: <Sparkles className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Mode realite augmentee",
      en: "Augmented reality mode",
      de: "Augmented-Reality-Modus",
      es: "Modo realidad aumentada",
      it: "Modalita realta aumentata",
    },
    text: {
      fr: "Depuis la carte, touchez \"Mode RA\" : la camera s'ouvre et un marqueur flottant s'ancre dans l'espace au-dessus de votre objectif. Un mini radar en haut a gauche montre la cible sur 360°, et les anneaux colores indiquent la proximite (rouge > vert). Quand vous etes aligne et proche, l'appareil vibre : cible verrouillee !",
      en: "From the map, tap \"AR mode\": the camera opens and a floating marker is pinned in space above your target. A mini radar in the top-left shows the target on 360°, and coloured rings indicate proximity (red > green). When you're lined up and close, the device vibrates: target locked!",
      de: "Tippen Sie auf der Karte auf \"AR-Modus\": Die Kamera offnet sich und ein schwebender Marker wird im Raum uber Ihrem Ziel verankert. Ein Mini-Radar oben links zeigt das Ziel auf 360°, farbige Ringe zeigen die Nahe (rot > grun). Wenn Sie ausgerichtet und nah sind, vibriert das Gerat: Ziel erfasst!",
      es: "Desde el mapa, pulsa \"Modo RA\": se abre la camara y un marcador flotante se ancla en el espacio sobre tu objetivo. Un mini radar arriba a la izquierda muestra el objetivo en 360°, y los anillos de colores indican la proximidad (rojo > verde). Cuando estas alineado y cerca, el dispositivo vibra: objetivo fijado!",
      it: "Dalla mappa, tocca \"Modalita AR\": la fotocamera si apre e un marcatore fluttuante viene ancorato nello spazio sopra l'obiettivo. Un mini radar in alto a sinistra mostra l'obiettivo a 360°, e gli anelli colorati indicano la prossimita (rosso > verde). Quando sei allineato e vicino, il dispositivo vibra: obiettivo agganciato!",
    },
  },
  {
    icon: <Camera className="h-10 w-10" />,
    color: "text-blue-400",
    title: {
      fr: "Perdu ? Prenez une photo",
      en: "Lost? Take a photo",
      de: "Verlaufen? Machen Sie ein Foto",
      es: "Perdido? Haz una foto",
      it: "Persi? Scattate una foto",
    },
    text: {
      fr: "Si le GPS vous dit que vous etes trop loin du bon endroit, vous pouvez prendre une photo de ce que vous voyez. Si c'est la bonne cible, l'etape se valide. Sinon, notre IA reconnait parfois un monument ou une statue et vous partage une petite anecdote pour enrichir votre decouverte. A utiliser avec moderation : l'enigme reste le cœur du jeu !",
      en: "If the GPS says you're too far from the right spot, you can take a photo of what you see. If it's the right target, the step is validated. Otherwise, our AI sometimes recognizes a monument or statue and shares a short fact to enrich your discovery. Use sparingly: the riddle is still the heart of the game!",
      de: "Wenn GPS sagt, dass Sie zu weit vom richtigen Ort entfernt sind, konnen Sie ein Foto machen. Wenn es das richtige Ziel ist, wird die Etappe bestatigt. Andernfalls erkennt unsere KI manchmal ein Denkmal oder eine Statue und teilt eine kurze Anekdote. Sparsam verwenden: Das Ratsel bleibt das Herz des Spiels!",
      es: "Si el GPS te dice que estas demasiado lejos del lugar correcto, puedes hacer una foto de lo que ves. Si es el objetivo correcto, la etapa se valida. De lo contrario, nuestra IA a veces reconoce un monumento o una estatua y comparte una breve anecdota. Usar con moderacion: el enigma sigue siendo el corazon del juego!",
      it: "Se il GPS dice che siete troppo lontani dal posto giusto, potete scattare una foto di cio che vedete. Se e l'obiettivo corretto, la tappa si convalida. Altrimenti, la nostra IA a volte riconosce un monumento o una statua e condivide un breve aneddoto. Usare con moderazione: l'enigma resta il cuore del gioco!",
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
