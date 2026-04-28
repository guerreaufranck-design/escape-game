"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
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
  Image as ImageIcon,
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
  title: Record<Locale, string>;
  text: Record<Locale, string>;
  color: string;
};

const getSlides = (estimatedDuration?: string): Slide[] => [
  // 1. Practical reminder before going outdoors.
  {
    icon: <Clock className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Avant de partir",
      en: "Before you head out",
      de: "Bevor Sie loslegen",
      es: "Antes de salir",
      it: "Prima di partire",
    },
    text: {
      fr: `Duree estimee : ${estimatedDuration || "1h30 a 2h"}, entierement a pied en exterieur. Prevoyez de l'eau, des chaussures confortables et un telephone bien charge — la camera et le GPS vont tourner pendant tout le parcours. Vous avez 24 heures a partir de l'activation pour terminer votre aventure (pause dejeuner, retour le lendemain matin, tout est OK).`,
      en: `Estimated duration: ${estimatedDuration || "1h30 to 2h"}, entirely on foot outdoors. Bring water, comfortable shoes and a well-charged phone — camera and GPS run the whole way. You have 24 hours from activation to finish your adventure (lunch break, come back the next morning, all fine).`,
      de: `Geschatzte Dauer: ${estimatedDuration || "1h30 bis 2h"}, komplett zu Fuss im Freien. Bringen Sie Wasser, bequeme Schuhe und ein gut geladenes Telefon mit — Kamera und GPS laufen die ganze Zeit. Sie haben 24 Stunden ab Aktivierung Zeit, um Ihr Abenteuer zu beenden (Mittagspause, am nachsten Morgen weitermachen, alles OK).`,
      es: `Duracion estimada: ${estimatedDuration || "1h30 a 2h"}, totalmente a pie al aire libre. Lleva agua, calzado comodo y un movil bien cargado — la camara y el GPS funcionan todo el rato. Tienes 24 horas desde la activacion para terminar tu aventura (pausa para comer, volver al dia siguiente, todo vale).`,
      it: `Durata stimata: ${estimatedDuration || "1h30 a 2h"}, interamente a piedi all'aperto. Portate acqua, scarpe comode e uno smartphone ben carico — fotocamera e GPS lavorano per tutto il percorso. Avete 24 ore dall'attivazione per terminare l'avventura (pausa pranzo, ripresa il mattino dopo, tutto OK).`,
    },
  },

  // 2. The new mechanic in one sentence.
  {
    icon: <Sparkles className="h-10 w-10" />,
    color: "text-fuchsia-400",
    title: {
      fr: "Realite Augmentee : la regle d'or",
      en: "Augmented Reality: the golden rule",
      de: "Augmented Reality: die goldene Regel",
      es: "Realidad Aumentada: la regla de oro",
      it: "Realta Aumentata: la regola d'oro",
    },
    text: {
      fr: "A chaque etape, ce jeu se joue UNIQUEMENT en realite augmentee. Une enigme vous raconte une histoire, vous guide jusqu'a un lieu, et vous demande d'ouvrir votre camera AR pour decouvrir ce que les murs cachent. Pas d'inscription a chercher dans le monde reel — la magie apparait sur votre ecran.",
      en: "At every step, this game is played EXCLUSIVELY in augmented reality. A riddle tells you a story, guides you to a location, and asks you to open your AR camera to discover what the walls are hiding. No real-world inscription to find — the magic appears on your screen.",
      de: "Bei jedem Schritt wird dieses Spiel AUSSCHLIESSLICH in Augmented Reality gespielt. Ein Ratsel erzahlt eine Geschichte, fuhrt Sie zu einem Ort und bittet Sie, Ihre AR-Kamera zu offnen. Keine Inschrift in der realen Welt zu finden — die Magie erscheint auf Ihrem Bildschirm.",
      es: "En cada etapa, este juego se juega UNICAMENTE en realidad aumentada. Un enigma te cuenta una historia, te guia hasta un lugar y te pide abrir tu camara AR para descubrir lo que ocultan los muros. No hay inscripciones que buscar — la magia aparece en tu pantalla.",
      it: "Ad ogni tappa, questo gioco si gioca SOLO in realta aumentata. Un enigma vi racconta una storia, vi guida verso un luogo, e vi chiede di aprire la fotocamera AR per scoprire cosa nascondono i muri. Niente iscrizioni da cercare nel mondo reale — la magia appare sul vostro schermo.",
    },
  },

  // 3. The walking tour layer — riddles narrate the city.
  {
    icon: <MapPin className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Une visite guidee dans chaque enigme",
      en: "A walking tour inside each riddle",
      de: "Eine Stadtfuhrung in jedem Ratsel",
      es: "Una visita guiada en cada enigma",
      it: "Una visita guidata in ogni enigma",
    },
    text: {
      fr: "Les enigmes sont des mini-recits historiques. Vous y decouvrirez ce que vous traverserez en chemin (une maison du XVIe, un cafe centenaire, une fontaine oubliee). C'est un tour touristique dans la peau d'un detective : ouvrez l'œil, ralentissez, lisez l'architecture autour de vous.",
      en: "Riddles are mini historical narratives. You'll learn what you'll walk past on the way (a 16th-century house, a hundred-year-old cafe, a forgotten fountain). It's a guided tour wearing a detective's coat: keep your eyes open, slow down, read the architecture around you.",
      de: "Die Ratsel sind kleine historische Erzahlungen. Sie erfahren, was Sie unterwegs sehen werden (ein Haus aus dem 16. Jahrhundert, ein hundertjahriges Cafe, ein vergessener Brunnen). Eine Stadtfuhrung im Detektivmantel: Augen offen halten, langsam gehen, die Architektur lesen.",
      es: "Los enigmas son micro-relatos historicos. Descubriras lo que cruzaras por el camino (una casa del siglo XVI, un cafe centenario, una fuente olvidada). Es un tour turistico con piel de detective: abre los ojos, ralentiza el paso, lee la arquitectura.",
      it: "Gli enigmi sono micro-racconti storici. Scoprirete cosa attraverserete lungo la strada (una casa del Cinquecento, un caffe centenario, una fontana dimenticata). E un tour turistico nei panni di un detective: occhi aperti, rallentate, leggete l'architettura.",
    },
  },

  // 4. Navigation: radar, distance, compass.
  {
    icon: <Navigation className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Le radar vous guide",
      en: "The radar guides you",
      de: "Der Radar fuhrt Sie",
      es: "El radar te guia",
      it: "Il radar vi guida",
    },
    text: {
      fr: "Sur la carte du jeu, un radar entoure votre position et pointe vers le prochain lieu. Une distance s'affiche en metres et un anneau de couleur change a mesure que vous approchez (rouge loin, vert proche). Pas de boussole a regler : tout est calcule en temps reel a partir de votre GPS.",
      en: "On the game map, a radar wraps around your position and points at the next location. A distance shows in metres and a coloured ring changes as you approach (red = far, green = close). No compass to fiddle with: it's all computed live from your GPS.",
      de: "Auf der Spielkarte umschliesst ein Radar Ihre Position und zeigt auf den nachsten Ort. Eine Entfernung in Metern wird angezeigt, und ein farbiger Ring andert sich beim Naherkommen (rot = weit, grun = nah). Kein Kompass zum Justieren: Alles wird live aus Ihrem GPS berechnet.",
      es: "En el mapa del juego, un radar rodea tu posicion y apunta al proximo lugar. Aparece una distancia en metros y un anillo de color cambia segun te acercas (rojo lejos, verde cerca). Sin brujula que ajustar: todo se calcula en directo desde tu GPS.",
      it: "Sulla mappa del gioco, un radar circonda la tua posizione e punta al prossimo luogo. Una distanza in metri viene mostrata e un anello colorato cambia mentre vi avvicinate (rosso lontano, verde vicino). Nessuna bussola da regolare: tutto e calcolato live dal vostro GPS.",
    },
  },

  // 5. The big purple AR button.
  {
    icon: <Sparkles className="h-10 w-10" />,
    color: "text-fuchsia-400",
    title: {
      fr: "Le grand bouton violet",
      en: "The big purple button",
      de: "Der grosse lila Knopf",
      es: "El gran boton morado",
      it: "Il grande pulsante viola",
    },
    text: {
      fr: "Une fois sur place, regardez en bas de votre ecran : le grand bouton violet \"Ouvrir la Realite Augmentee\" est votre seul outil. Tapez-le. La camera s'ouvre, vous etes dans le mode jeu. C'est ICI que les indices se reveleront — jamais dans le monde reel.",
      en: "Once on site, look at the bottom of your screen: the big purple button \"Open Augmented Reality\" is your only tool. Tap it. The camera opens, you're in game mode. This is WHERE the clues reveal themselves — never in the real world.",
      de: "Wenn Sie vor Ort sind, schauen Sie auf den unteren Bildschirmrand: Der grosse lila Knopf \"Augmented Reality offnen\" ist Ihr einziges Werkzeug. Tippen Sie darauf. Die Kamera offnet sich, Sie sind im Spielmodus. HIER offenbaren sich die Hinweise — nie in der realen Welt.",
      es: "Una vez en el lugar, mira la parte inferior de tu pantalla: el gran boton morado \"Abrir Realidad Aumentada\" es tu unica herramienta. Pulsalo. La camara se abre, estas en modo juego. AQUI se revelan las pistas — nunca en el mundo real.",
      it: "Una volta sul posto, guardate il fondo dello schermo: il grande pulsante viola \"Apri Realta Aumentata\" e il vostro unico strumento. Toccatelo. La fotocamera si apre, siete in modalita gioco. E QUI che gli indizi si rivelano — mai nel mondo reale.",
    },
  },

  // 6. THE active discovery — scan everything around you.
  {
    icon: <ScanLine className="h-10 w-10" />,
    color: "text-amber-400",
    title: {
      fr: "Cherchez l'indice partout",
      en: "Hunt the clue everywhere",
      de: "Suchen Sie den Hinweis uberall",
      es: "Busca la pista por todas partes",
      it: "Cercate l'indizio ovunque",
    },
    text: {
      fr: "Une fois la camera ouverte, balayez LENTEMENT tout ce qui vous entoure — les murs, le sol pave, les portes, les fenetres, les balcons, le ciel, les recoins sombres. Quelque part autour de vous, des lettres dorees vont se materialiser sur une surface : c'est votre reponse. Ne restez pas immobile, bougez le telephone dans toutes les directions.",
      en: "Once the camera is open, slowly sweep EVERYTHING around you — walls, cobblestones, doors, windows, balconies, the sky, dark corners. Somewhere around you, golden letters will materialise on a surface: that's your answer. Don't stand still — move the phone in all directions.",
      de: "Wenn die Kamera offen ist, schwenken Sie LANGSAM uber ALLES um sich herum — Wande, Kopfsteinpflaster, Turen, Fenster, Balkone, den Himmel, dunkle Ecken. Irgendwo werden goldene Buchstaben auf einer Flache erscheinen: das ist Ihre Antwort. Bleiben Sie nicht stehen — bewegen Sie das Telefon in alle Richtungen.",
      es: "Una vez la camara abierta, barre LENTAMENTE TODO a tu alrededor — muros, adoquines, puertas, ventanas, balcones, el cielo, rincones oscuros. En algun lugar, letras doradas apareceran en una superficie: esa es tu respuesta. No te quedes inmovil, mueve el movil en todas direcciones.",
      it: "Una volta aperta la fotocamera, scorrete LENTAMENTE TUTTO intorno a voi — muri, pavimentazione, porte, finestre, balconi, il cielo, angoli bui. Da qualche parte, lettere dorate si materializzeranno su una superficie: quella e la vostra risposta. Non state fermi, muovete il telefono in tutte le direzioni.",
    },
  },

  // 7. The character + voice narration.
  {
    icon: <Volume2 className="h-10 w-10" />,
    color: "text-violet-400",
    title: {
      fr: "Un personnage vous parle",
      en: "A character speaks to you",
      de: "Eine Figur spricht zu Ihnen",
      es: "Un personaje te habla",
      it: "Un personaggio vi parla",
    },
    text: {
      fr: "Pendant que vous fouillez en RA, un personnage (chevalier, sorciere, moine, marin, detective, fantome ou guide OddballTrip) apparait au centre de l'ecran et vous murmure une phrase d'ambiance. Tapez l'icone haut-parleur dans la bulle pour entendre sa voix dans votre langue. C'est de l'ambiance, pas un spoiler — la reponse n'est PAS dans son texte.",
      en: "While you're hunting in AR, a character (knight, witch, monk, sailor, detective, ghost or OddballTrip guide) appears centre-screen and whispers an atmospheric line. Tap the speaker icon in the bubble to hear their voice in your language. It's mood, not spoiler — the answer is NOT in what they say.",
      de: "Wahrend Sie in AR suchen, erscheint eine Figur (Ritter, Hexe, Monch, Seemann, Detektiv, Geist oder OddballTrip-Guide) in der Bildschirmmitte und flustert eine Atmosphare-Zeile. Tippen Sie auf das Lautsprechersymbol in der Sprechblase, um die Stimme in Ihrer Sprache zu horen. Das ist Stimmung, kein Spoiler — die Antwort steht NICHT in ihrem Text.",
      es: "Mientras buscas en AR, un personaje (caballero, bruja, monje, marino, detective, fantasma o guia OddballTrip) aparece en el centro y te susurra una frase de ambiente. Toca el icono de altavoz en la burbuja para oir su voz en tu idioma. Es atmosfera, no pista — la respuesta NO esta en lo que dice.",
      it: "Mentre cercate in AR, un personaggio (cavaliere, strega, monaco, marinaio, detective, fantasma o guida OddballTrip) appare al centro dello schermo e sussurra una frase d'atmosfera. Toccate l'icona altoparlante nella bolla per sentire la voce nella vostra lingua. E atmosfera, non spoiler — la risposta NON e nel suo testo.",
    },
  },

  // 8. Notebook = answers from AR.
  {
    icon: <BookOpen className="h-10 w-10" />,
    color: "text-emerald-400",
    title: {
      fr: "Notez la reponse vue en RA",
      en: "Write the answer you saw in AR",
      de: "Notieren Sie die in AR gesehene Antwort",
      es: "Anota la respuesta vista en AR",
      it: "Annotate la risposta vista in AR",
    },
    text: {
      fr: "Quand les lettres dorees apparaissent, fermez la camera et tapez exactement ce que vous avez vu dans le carnet (icone livre en haut a droite). Validez avec le bouton vert \"Valider la reponse\". Toutes vos reponses se cumulent : a la fin, vous tapez le code complet pour debloquer la victoire et l'epilogue narratif.",
      en: "When the golden letters appear, close the camera and type exactly what you saw into the notebook (book icon top-right). Validate with the green \"Validate answer\" button. All your answers stack: at the end, you type the full code to unlock victory and the narrative epilogue.",
      de: "Wenn die goldenen Buchstaben erscheinen, schliessen Sie die Kamera und tippen Sie genau das ein, was Sie gesehen haben, ins Notizbuch (Buchsymbol oben rechts). Bestatigen Sie mit dem grunen Knopf \"Antwort bestatigen\". Alle Antworten summieren sich: am Ende tippen Sie den vollstandigen Code, um den Sieg und den narrativen Epilog freizuschalten.",
      es: "Cuando aparezcan las letras doradas, cierra la camara y escribe exactamente lo que viste en el cuaderno (icono libro arriba derecha). Valida con el boton verde \"Validar respuesta\". Todas tus respuestas se acumulan: al final escribes el codigo completo para desbloquear la victoria y el epilogo narrativo.",
      it: "Quando appaiono le lettere dorate, chiudete la fotocamera e digitate esattamente cio che avete visto nel taccuino (icona libro in alto a destra). Convalidate con il pulsante verde \"Convalida risposta\". Tutte le risposte si accumulano: alla fine digitate il codice completo per sbloccare vittoria ed epilogo narrativo.",
    },
  },

  // 9. Hints — now help with the SCAN, not the answer.
  {
    icon: <Lightbulb className="h-10 w-10" />,
    color: "text-yellow-400",
    title: {
      fr: "Coince ? Demandez un indice",
      en: "Stuck? Ask for a hint",
      de: "Festgefahren? Fordern Sie einen Hinweis an",
      es: "Atascado? Pide una pista",
      it: "Bloccati? Chiedete un indizio",
    },
    text: {
      fr: "Vous tournez en rond, l'indice ne se montre pas ? Demandez un indice (icone ampoule). Les deux premiers vous aident a CHERCHER (\"essayez plus a l'est\", \"plus bas que vos yeux\"), le troisieme decrit la FORME de la reponse (\"un mot latin de 6 lettres\"). Chaque indice coute du temps — utilisez-les avec parcimonie pour rester en haut du classement.",
      en: "Going in circles, the clue won't show? Ask for a hint (bulb icon). The first two help you SEARCH (\"try further east\", \"lower than eye level\"), the third describes the SHAPE of the answer (\"a 6-letter Latin word\"). Each hint costs time — use them sparingly to stay on top of the leaderboard.",
      de: "Drehen sich im Kreis, der Hinweis erscheint nicht? Fordern Sie einen Hinweis an (Gluhbirnen-Symbol). Die ersten beiden helfen beim SUCHEN (\"weiter ostlich versuchen\", \"unter Augenhohe\"), der dritte beschreibt die FORM der Antwort (\"ein 6-Buchstaben-Latein-Wort\"). Jeder Hinweis kostet Zeit — sparsam einsetzen, um oben in der Rangliste zu bleiben.",
      es: "Das vueltas, la pista no aparece? Pide una pista (icono bombilla). Las dos primeras ayudan a BUSCAR (\"prueba mas al este\", \"mas abajo de los ojos\"), la tercera describe la FORMA de la respuesta (\"una palabra latina de 6 letras\"). Cada pista cuesta tiempo — usalas con moderacion para mantener tu puesto en la clasificacion.",
      it: "Girate a vuoto, l'indizio non appare? Chiedete un indizio (icona lampadina). I primi due aiutano a CERCARE (\"provate piu a est\", \"sotto il livello degli occhi\"), il terzo descrive la FORMA della risposta (\"una parola latina di 6 lettere\"). Ogni indizio costa tempo — usateli con moderazione per restare in cima alla classifica.",
    },
  },

  // 10. Endgame: leaderboard + selfie + epilogue.
  {
    icon: <Trophy className="h-10 w-10" />,
    color: "text-yellow-400",
    title: {
      fr: "Victoire, selfie et classement",
      en: "Victory, selfie and leaderboard",
      de: "Sieg, Selfie und Rangliste",
      es: "Victoria, selfie y clasificacion",
      it: "Vittoria, selfie e classifica",
    },
    text: {
      fr: "Apres la 8e enigme resolue, vous decouvrez l'epilogue narratif (la verite revelee), votre place au classement general (moins de penalites = meilleur score), et un selfie souvenir auto-genere pour partager votre exploit sur les reseaux. Profitez du moment : vous avez explore une ville comme personne.",
      en: "After the 8th riddle is solved, you discover the narrative epilogue (the truth revealed), your place on the global leaderboard (fewer penalties = better score), and an auto-generated keepsake selfie to share your exploit on social media. Enjoy the moment: you've explored a city like no one else.",
      de: "Nach dem 8. gelosten Ratsel entdecken Sie den narrativen Epilog (die enthullte Wahrheit), Ihren Platz in der globalen Rangliste (weniger Strafen = bessere Punktzahl) und ein automatisch generiertes Erinnerungs-Selfie zum Teilen in sozialen Medien. Geniessen Sie den Moment: Sie haben eine Stadt erkundet wie kein anderer.",
      es: "Despues del 8o enigma resuelto, descubres el epilogo narrativo (la verdad revelada), tu puesto en la clasificacion global (menos penalizaciones = mejor puntuacion), y un selfie de recuerdo auto-generado para compartir en redes. Disfruta el momento: has explorado una ciudad como nadie.",
      it: "Dopo l'ottavo enigma risolto, scoprite l'epilogo narrativo (la verita rivelata), il vostro posto nella classifica globale (meno penalita = punteggio migliore), e un selfie ricordo auto-generato da condividere sui social. Godetevi il momento: avete esplorato una citta come nessun altro.",
    },
  },

  // 11. Safety — last slide.
  {
    icon: <Shield className="h-10 w-10" />,
    color: "text-blue-400",
    title: {
      fr: "Restez en securite",
      en: "Stay safe",
      de: "Bleiben Sie sicher",
      es: "Mantente seguro",
      it: "Restate in sicurezza",
    },
    text: {
      fr: "Le jeu se passe dans la rue : levez la tete entre deux scans, evitez de marcher en regardant la camera, traversez UNIQUEMENT aux passages pietons. Le parcours a ete trace pour rester dans un meme quartier, mais soyez attentifs aux velos, voitures et trottinettes. En cas d'urgence, le 112 marche partout en Europe.",
      en: "The game happens on the street: look up between scans, don't walk while staring at the camera, cross ONLY at pedestrian crossings. The route stays in one neighbourhood by design, but watch out for bikes, cars and scooters. Emergency number 112 works across Europe.",
      de: "Das Spiel findet auf der Strasse statt: Schauen Sie zwischen Scans hoch, gehen Sie nicht, wahrend Sie auf die Kamera starren, uberqueren Sie NUR an Fusgangeruberwegen. Die Route bleibt im selben Viertel, aber achten Sie auf Fahrrader, Autos und Roller. Notrufnummer 112 funktioniert europaweit.",
      es: "El juego ocurre en la calle: levanta la cabeza entre escaneos, no camines mirando la camara, cruza SOLO por pasos de peatones. El recorrido se queda en un solo barrio por diseno, pero atento a bicis, coches y patinetes. El 112 funciona en toda Europa.",
      it: "Il gioco si svolge per strada: alzate la testa tra una scansione e l'altra, non camminate guardando la fotocamera, attraversate SOLO sulle strisce pedonali. Il percorso resta in uno stesso quartiere per scelta, ma fate attenzione a bici, auto e monopattini. Il 112 funziona in tutta Europa.",
    },
  },
];

export function Tutorial({
  locale,
  gameTitle,
  totalSteps,
  estimatedDuration,
  onComplete,
}: TutorialProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const slides = getSlides(estimatedDuration);
  const slide = slides[currentSlide];
  const isLast = currentSlide === slides.length - 1;

  // Helper: fallback to en then fr for non-static locales (e.g. nl, pt, etc.)
  const l = (dict: Record<string, string>) =>
    dict[locale] || dict.en || dict.fr || "";

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
        <p className="text-xs text-slate-500 mt-1">
          {totalSteps} {l(stepsLabel)}
        </p>
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full">
        <div className={`mb-6 ${slide.color}`}>{slide.icon}</div>
        <h2 className="text-lg font-bold text-center mb-3">{l(slide.title)}</h2>
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
            {l({
              fr: "Passer le tutoriel",
              en: "Skip tutorial",
              de: "Tutorial uberspringen",
              es: "Saltar tutorial",
              it: "Salta il tutorial",
            })}
          </button>
        )}
      </div>
    </div>
  );
}
