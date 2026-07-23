import type { StaticLocale } from './i18n';

type Translations = Record<string, Record<StaticLocale, string>>;

export const ui: Translations = {
  // Home page
  'home.title': {
    fr: 'Escape Game',
    en: 'Escape Game',
    de: 'Escape Game',
    es: 'Escape Game',
    it: 'Escape Game',
  },
  'home.outdoor': {
    fr: 'Outdoor',
    en: 'Outdoor',
    de: 'Outdoor',
    es: 'Outdoor',
    it: 'Outdoor',
  },
  'home.subtitle': {
    fr: 'Explorez, resolvez, triomphez. L\'aventure vous attend dehors.',
    en: 'Explore, solve, triumph. The adventure awaits you outside.',
    de: 'Erkunden, losen, triumphieren. Das Abenteuer erwartet Sie draussen.',
    es: 'Explora, resuelve, triunfa. La aventura te espera afuera.',
    it: 'Esplora, risolvi, trionfa. L\'avventura ti aspetta fuori.',
  },
  'home.badge.geolocation': {
    fr: 'Geolocalisation',
    en: 'Geolocation',
    de: 'Geolokalisierung',
    es: 'Geolocalizacion',
    it: 'Geolocalizzazione',
  },
  'home.badge.ranking': {
    fr: 'Classement',
    en: 'Ranking',
    de: 'Rangliste',
    es: 'Clasificacion',
    it: 'Classifica',
  },
  'home.badge.riddles': {
    fr: 'Enigmes',
    en: 'Riddles',
    de: 'Ratsel',
    es: 'Enigmas',
    it: 'Enigmi',
  },
  'home.enterCode': {
    fr: 'Entrez votre code',
    en: 'Enter your code',
    de: 'Geben Sie Ihren Code ein',
    es: 'Ingrese su codigo',
    it: 'Inserisci il tuo codice',
  },
  'home.activationCode': {
    fr: 'Code d\'activation',
    en: 'Activation code',
    de: 'Aktivierungscode',
    es: 'Codigo de activacion',
    it: 'Codice di attivazione',
  },
  'home.yourName': {
    fr: 'Votre nom',
    en: 'Your name',
    de: 'Ihr Name',
    es: 'Tu nombre',
    it: 'Il tuo nome',
  },
  'home.playerNamePlaceholder': {
    fr: 'Votre nom de joueur',
    en: 'Your player name',
    de: 'Ihr Spielername',
    es: 'Tu nombre de jugador',
    it: 'Il tuo nome giocatore',
  },
  'home.teamName': {
    fr: 'Nom d\'equipe',
    en: 'Team name',
    de: 'Teamname',
    es: 'Nombre del equipo',
    it: 'Nome della squadra',
  },
  'home.optional': {
    fr: '(optionnel)',
    en: '(optional)',
    de: '(optional)',
    es: '(opcional)',
    it: '(opzionale)',
  },
  'home.teamPlaceholder': {
    fr: 'Nom de votre equipe',
    en: 'Your team name',
    de: 'Name Ihres Teams',
    es: 'Nombre de tu equipo',
    it: 'Nome della tua squadra',
  },
  'home.startAdventure': {
    fr: 'Lancer l\'aventure',
    en: 'Start the adventure',
    de: 'Abenteuer starten',
    es: 'Iniciar la aventura',
    it: 'Inizia l\'avventura',
  },
  'home.viewLeaderboard': {
    fr: 'Voir le classement general',
    en: 'View general ranking',
    de: 'Gesamtrangliste anzeigen',
    es: 'Ver clasificacion general',
    it: 'Vedi classifica generale',
  },
  'home.invalidCode': {
    fr: 'Format de code invalide (XXXX-XXXX-XXXX)',
    en: 'Invalid code format (XXXX-XXXX-XXXX)',
    de: 'Ungultiges Codeformat (XXXX-XXXX-XXXX)',
    es: 'Formato de codigo invalido (XXXX-XXXX-XXXX)',
    it: 'Formato codice non valido (XXXX-XXXX-XXXX)',
  },
  'home.nameTooShort': {
    fr: 'Entrez votre nom (min. 2 caracteres)',
    en: 'Enter your name (min. 2 characters)',
    de: 'Geben Sie Ihren Namen ein (min. 2 Zeichen)',
    es: 'Ingrese su nombre (min. 2 caracteres)',
    it: 'Inserisci il tuo nome (min. 2 caratteri)',
  },
  'home.activationError': {
    fr: 'Erreur d\'activation',
    en: 'Activation error',
    de: 'Aktivierungsfehler',
    es: 'Error de activacion',
    it: 'Errore di attivazione',
  },
  'home.connectionError': {
    fr: 'Erreur de connexion au serveur',
    en: 'Server connection error',
    de: 'Serververbindungsfehler',
    es: 'Error de conexion al servidor',
    it: 'Errore di connessione al server',
  },

  // Language selection screen
  'lang.title': {
    fr: 'Choisissez votre langue',
    en: 'Choose your language',
    de: 'Wahlen Sie Ihre Sprache',
    es: 'Elige tu idioma',
    it: 'Scegli la tua lingua',
  },
  'lang.subtitle': {
    fr: 'Seleccione / Select / Wahlen',
    en: 'Seleccione / Select / Wahlen',
    de: 'Seleccione / Select / Wahlen',
    es: 'Seleccione / Select / Wahlen',
    it: 'Seleccione / Select / Wahlen',
  },

  // Tutorial
  'tutorial.next': {
    fr: 'Suivant',
    en: 'Next',
    de: 'Weiter',
    es: 'Siguiente',
    it: 'Avanti',
  },
  'tutorial.prev': {
    fr: 'Precedent',
    en: 'Previous',
    de: 'Zuruck',
    es: 'Anterior',
    it: 'Precedente',
  },
  'tutorial.start': {
    fr: 'C\'est parti !',
    en: 'Let\'s go!',
    de: 'Los geht\'s!',
    es: 'Vamos!',
    it: 'Andiamo!',
  },
  'tutorial.skip': {
    fr: 'Passer le tutoriel',
    en: 'Skip tutorial',
    de: 'Tutorial uberspringen',
    es: 'Saltar tutorial',
    it: 'Salta tutorial',
  },
  'tutorial.welcome': {
    fr: 'Bienvenue dans', en: 'Welcome to', de: 'Willkommen bei', es: 'Bienvenido a', it: 'Benvenuto in',
  },
  'tutorial.steps': {
    fr: 'etapes', en: 'steps', de: 'Schritte', es: 'etapas', it: 'tappe',
  },
  'tutorial.startCta': {
    fr: "C'est compris, on y va !", en: "Got it, let's go!", de: "Verstanden, los geht's!", es: 'Entendido, vamos!', it: 'Capito, andiamo!',
  },

  // Tutorial slides (11 slides x title/text). The {duration} placeholder
  // in s1.text is replaced client-side with the game's estimated duration.
  'tutorial.s1.title': {
    fr: 'Lis bien ce qui suit', en: 'Read what follows carefully', de: 'Lies das Folgende sorgfaltig', es: 'Lee bien lo que sigue', it: 'Leggi attentamente quanto segue',
  },
  'tutorial.s1.text': {
    fr: "5 ecrans, 30 secondes. C'est tout ce qu'il te faut pour comprendre comment jouer. Sans ces 5 ecrans, tu vas tourner en rond sur place sans savoir quoi faire. Personne n'a deja tout devine sans tutoriel. Prends le temps de les lire jusqu'au bout, vraiment.",
    en: '5 screens, 30 seconds. That is all you need to understand how to play. Without these 5 screens, you will go in circles on-site with no clue what to do. No one has ever figured it out without the tutorial. Take the time to read them through, really.',
    de: '5 Bildschirme, 30 Sekunden. Das ist alles, was du brauchst, um das Spiel zu verstehen. Ohne diese 5 Bildschirme drehst du dich vor Ort im Kreis, ohne zu wissen, was zu tun ist. Niemand hat es je ohne Tutorial herausgefunden. Nimm dir die Zeit, sie wirklich bis zum Ende zu lesen.',
    es: '5 pantallas, 30 segundos. Es todo lo que necesitas para entender como jugar. Sin estas 5 pantallas, vas a dar vueltas en el sitio sin saber que hacer. Nadie lo ha adivinado nunca sin el tutorial. Toma el tiempo de leerlas hasta el final, de verdad.',
    it: "5 schermate, 30 secondi. E tutto cio che ti serve per capire come si gioca. Senza queste 5 schermate, girerai a vuoto sul posto senza sapere cosa fare. Nessuno l'ha mai capito senza il tutorial. Prenditi il tempo di leggerle fino in fondo, davvero.",
  },
  'tutorial.s2.title': {
    fr: "La camera reste ouverte tout le temps", en: 'The camera stays open the whole time', de: 'Die Kamera bleibt die ganze Zeit offen', es: 'La camara queda abierta todo el tiempo', it: 'La fotocamera resta aperta tutto il tempo',
  },
  'tutorial.s2.text': {
    fr: "Tu joues a travers la camera de ton telephone du debut a la fin. Pendant que tu marches, elle te montre la realite augmentee : un radar et une fleche qui pointent vers le prochain lieu, la distance qui descend en metres. Une fois sur place, des lettres dorees se materialisent sur les murs autour de toi : c'est ta reponse. Tu n'as pas a ouvrir/fermer la camera : elle est l'unique vue du jeu.",
    en: "You play through your phone camera from start to finish. While you walk, it shows augmented reality: a radar and an arrow pointing at the next location, distance ticking down in metres. Once you arrive, golden letters materialise on the walls around you — that's your answer. You don't open/close the camera: it's the one and only view of the game.",
    de: 'Du spielst durch deine Handy-Kamera von Anfang bis Ende. Beim Gehen zeigt sie Augmented Reality: einen Radar und einen Pfeil, der auf den nachsten Ort zeigt, die Entfernung in Metern. Sobald du ankommst, erscheinen goldene Buchstaben auf den Wanden um dich herum — das ist deine Antwort. Du musst die Kamera nicht offnen/schliessen: Sie ist die einzige Spielansicht.',
    es: 'Juegas a traves de la camara de tu movil de principio a fin. Mientras caminas, te muestra realidad aumentada: un radar y una flecha que apuntan al proximo lugar, la distancia descendiendo en metros. Una vez en el sitio, letras doradas aparecen en los muros a tu alrededor — esa es tu respuesta. No tienes que abrir/cerrar la camara: es la unica vista del juego.',
    it: "Giochi attraverso la fotocamera del telefono dall'inizio alla fine. Mentre cammini, ti mostra realta aumentata: un radar e una freccia che puntano al prossimo luogo, la distanza che scende in metri. Una volta arrivato, lettere dorate si materializzano sui muri intorno a te — quella e la tua risposta. Non devi aprire/chiudere la fotocamera: e l'unica vista del gioco.",
  },
  'tutorial.s3.title': {
    fr: 'Une visite guidee dans chaque enigme', en: 'A walking tour inside each riddle', de: 'Eine Stadtfuhrung in jedem Ratsel', es: 'Una visita guiada en cada enigma', it: 'Una visita guidata in ogni enigma',
  },
  'tutorial.s3.text': {
    fr: "Les enigmes sont des mini-recits historiques. Vous y decouvrirez ce que vous traverserez en chemin (une maison du XVIe, un cafe centenaire, une fontaine oubliee). C'est un tour touristique dans la peau d'un detective : ouvrez l'oeil, ralentissez, lisez l'architecture autour de vous.",
    en: "Riddles are mini historical narratives. You'll learn what you'll walk past on the way (a 16th-century house, a hundred-year-old cafe, a forgotten fountain). It's a guided tour wearing a detective's coat: keep your eyes open, slow down, read the architecture around you.",
    de: 'Die Ratsel sind kleine historische Erzahlungen. Sie erfahren, was Sie unterwegs sehen werden (ein Haus aus dem 16. Jahrhundert, ein hundertjahriges Cafe, ein vergessener Brunnen). Eine Stadtfuhrung im Detektivmantel: Augen offen halten, langsam gehen, die Architektur lesen.',
    es: 'Los enigmas son micro-relatos historicos. Descubriras lo que cruzaras por el camino (una casa del siglo XVI, un cafe centenario, una fuente olvidada). Es un tour turistico con piel de detective: abre los ojos, ralentiza el paso, lee la arquitectura.',
    it: "Gli enigmi sono micro-racconti storici. Scoprirete cosa attraverserete lungo la strada (una casa del Cinquecento, un caffe centenario, una fontana dimenticata). E un tour turistico nei panni di un detective: occhi aperti, rallentate, leggete l'architettura.",
  },
  'tutorial.s4.title': {
    fr: 'Le radar vous guide', en: 'The radar guides you', de: 'Der Radar fuhrt Sie', es: 'El radar te guia', it: 'Il radar vi guida',
  },
  'tutorial.s4.text': {
    fr: "Sur la carte du jeu, un radar entoure votre position et pointe vers le prochain lieu. Une distance s'affiche en metres et un anneau de couleur change a mesure que vous approchez (rouge loin, vert proche). Pas de boussole a regler : tout est calcule en temps reel a partir de votre GPS.",
    en: "On the game map, a radar wraps around your position and points at the next location. A distance shows in metres and a coloured ring changes as you approach (red = far, green = close). No compass to fiddle with: it's all computed live from your GPS.",
    de: 'Auf der Spielkarte umschliesst ein Radar Ihre Position und zeigt auf den nachsten Ort. Eine Entfernung in Metern wird angezeigt, und ein farbiger Ring andert sich beim Naherkommen (rot = weit, grun = nah). Kein Kompass zum Justieren: Alles wird live aus Ihrem GPS berechnet.',
    es: 'En el mapa del juego, un radar rodea tu posicion y apunta al proximo lugar. Aparece una distancia en metros y un anillo de color cambia segun te acercas (rojo lejos, verde cerca). Sin brujula que ajustar: todo se calcula en directo desde tu GPS.',
    it: 'Sulla mappa del gioco, un radar circonda la tua posizione e punta al prossimo luogo. Una distanza in metri viene mostrata e un anello colorato cambia mentre vi avvicinate (rosso lontano, verde vicino). Nessuna bussola da regolare: tutto e calcolato live dal vostro GPS.',
  },
  'tutorial.s5.title': {
    fr: 'Autorise la camera au debut', en: 'Allow camera access at the start', de: 'Kamerazugriff am Anfang erlauben', es: 'Permite la camara al inicio', it: 'Autorizza la fotocamera all inizio',
  },
  'tutorial.s5.text': {
    fr: "La toute premiere fois, ton telephone va te demander l'autorisation d'utiliser la camera. Accepte-la, sinon le jeu ne peut pas commencer. Apres ce \"oui\" initial, plus aucune action de ta part : la camera se lance et reste ouverte tout le long. Si jamais elle ne demarre pas, le grand bouton violet \"{arButton}\" en bas de l'ecran la (re)lance manuellement.",
    en: "The very first time, your phone will ask permission to use the camera. Accept it, otherwise the game cannot start. After that initial yes, you don't do anything: the camera launches and stays open the whole way. If it ever fails to start, the big purple \"{arButton}\" button at the bottom of the screen (re)launches it manually.",
    de: "Beim allerersten Mal fragt dein Handy nach Kameraerlaubnis. Akzeptiere sie, sonst kann das Spiel nicht starten. Nach diesem ersten Ja musst du nichts mehr tun: Die Kamera startet und bleibt die ganze Zeit offen. Falls sie nicht startet, ist der grosse lila Knopf \"{arButton}\" unten am Bildschirm da, um sie manuell (neu) zu starten.",
    es: "La primera vez, tu movil te pedira permiso para usar la camara. Acepta, si no el juego no puede empezar. Despues de ese si inicial, no haces nada mas: la camara se lanza y queda abierta todo el rato. Si no arranca, el gran boton morado \"{arButton}\" abajo de la pantalla la (re)lanza manualmente.",
    it: "La primissima volta, il telefono chiedera il permesso di usare la fotocamera. Accettalo, altrimenti il gioco non puo iniziare. Dopo quel si iniziale, non fai piu nulla: la fotocamera parte e resta aperta tutto il tempo. Se non parte, il grande pulsante viola \"{arButton}\" in basso allo schermo la (ri)lancia manualmente.",
  },
  'tutorial.s6.title': {
    fr: "Une fois sur place, balaye autour de toi", en: 'Once on site, sweep around you', de: 'Vor Ort: schwenke um dich herum', es: 'Una vez en el sitio, barre a tu alrededor', it: "Una volta sul posto, scorri intorno a te",
  },
  'tutorial.s6.text': {
    fr: "Quand le radar te dit que tu es arrive, balaye LENTEMENT avec ta camera tout ce qui t'entoure — les murs, le sol pave, les portes, les fenetres, les balcons, le ciel, les recoins sombres. Quelque part, des lettres dorees vont se materialiser sur une surface : c'est ta reponse. Ne reste pas immobile, bouge le telephone dans toutes les directions.",
    en: "When the radar says you've arrived, slowly sweep EVERYTHING around you with the camera — walls, cobblestones, doors, windows, balconies, the sky, dark corners. Somewhere, golden letters will materialise on a surface: that's your answer. Don't stand still — move the phone in all directions.",
    de: 'Wenn der Radar sagt, dass du angekommen bist, schwenke LANGSAM mit der Kamera uber ALLES um dich herum — Wande, Kopfsteinpflaster, Turen, Fenster, Balkone, den Himmel, dunkle Ecken. Irgendwo werden goldene Buchstaben auf einer Flache erscheinen: das ist deine Antwort. Bleibe nicht stehen — bewege das Telefon in alle Richtungen.',
    es: 'Cuando el radar diga que has llegado, barre LENTAMENTE con la camara TODO a tu alrededor — muros, adoquines, puertas, ventanas, balcones, el cielo, rincones oscuros. En algun lugar, letras doradas apareceran en una superficie: esa es tu respuesta. No te quedes inmovil, mueve el movil en todas direcciones.',
    it: "Quando il radar ti dice che sei arrivato, scorri LENTAMENTE con la fotocamera TUTTO intorno a te — muri, pavimentazione, porte, finestre, balconi, il cielo, angoli bui. Da qualche parte, lettere dorate si materializzeranno su una superficie: quella e la tua risposta. Non stare fermo, muovi il telefono in tutte le direzioni.",
  },
  'tutorial.s7.title': {
    fr: 'Un personnage vous parle', en: 'A character speaks to you', de: 'Eine Figur spricht zu Ihnen', es: 'Un personaje te habla', it: 'Un personaggio vi parla',
  },
  'tutorial.s7.text': {
    fr: "Pendant que vous fouillez en RA, un personnage (chevalier, sorciere, moine, marin, detective, fantome ou guide OddballTrip) apparait au centre de l'ecran et vous murmure une phrase d'ambiance. Tapez l'icone haut-parleur dans la bulle pour entendre sa voix dans votre langue. C'est de l'ambiance, pas un spoiler — la reponse n'est PAS dans son texte.",
    en: "While you're hunting in AR, a character (knight, witch, monk, sailor, detective, ghost or OddballTrip guide) appears centre-screen and whispers an atmospheric line. Tap the speaker icon in the bubble to hear their voice in your language. It's mood, not spoiler — the answer is NOT in what they say.",
    de: 'Wahrend Sie in AR suchen, erscheint eine Figur (Ritter, Hexe, Monch, Seemann, Detektiv, Geist oder OddballTrip-Guide) in der Bildschirmmitte und flustert eine Atmosphare-Zeile. Tippen Sie auf das Lautsprechersymbol in der Sprechblase, um die Stimme in Ihrer Sprache zu horen. Das ist Stimmung, kein Spoiler — die Antwort steht NICHT in ihrem Text.',
    es: 'Mientras buscas en AR, un personaje (caballero, bruja, monje, marino, detective, fantasma o guia OddballTrip) aparece en el centro y te susurra una frase de ambiente. Toca el icono de altavoz en la burbuja para oir su voz en tu idioma. Es atmosfera, no pista — la respuesta NO esta en lo que dice.',
    it: "Mentre cercate in AR, un personaggio (cavaliere, strega, monaco, marinaio, detective, fantasma o guida OddballTrip) appare al centro dello schermo e sussurra una frase d'atmosfera. Toccate l'icona altoparlante nella bolla per sentire la voce nella vostra lingua. E atmosfera, non spoiler — la risposta NON e nel suo testo.",
  },
  'tutorial.s8.title': {
    fr: 'Notez la reponse vue en RA', en: 'Write the answer you saw in AR', de: 'Notieren Sie die in AR gesehene Antwort', es: 'Anota la respuesta vista en AR', it: 'Annotate la risposta vista in AR',
  },
  'tutorial.s8.text': {
    fr: "Quand les lettres dorees apparaissent, fermez la camera et tapez exactement ce que vous avez vu dans le carnet (icone livre en haut a droite). Validez avec le bouton vert \"Valider la reponse\". Toutes vos reponses se cumulent : a la fin, vous tapez le code complet pour debloquer la victoire et l'epilogue narratif.",
    en: "When the golden letters appear, close the camera and type exactly what you saw into the notebook (book icon top-right). Validate with the green \"Validate answer\" button. All your answers stack: at the end, you type the full code to unlock victory and the narrative epilogue.",
    de: "Wenn die goldenen Buchstaben erscheinen, schliessen Sie die Kamera und tippen Sie genau das ein, was Sie gesehen haben, ins Notizbuch (Buchsymbol oben rechts). Bestatigen Sie mit dem grunen Knopf \"Antwort bestatigen\". Alle Antworten summieren sich: am Ende tippen Sie den vollstandigen Code, um den Sieg und den narrativen Epilog freizuschalten.",
    es: "Cuando aparezcan las letras doradas, cierra la camara y escribe exactamente lo que viste en el cuaderno (icono libro arriba derecha). Valida con el boton verde \"Validar respuesta\". Todas tus respuestas se acumulan: al final escribes el codigo completo para desbloquear la victoria y el epilogo narrativo.",
    it: "Quando appaiono le lettere dorate, chiudete la fotocamera e digitate esattamente cio che avete visto nel taccuino (icona libro in alto a destra). Convalidate con il pulsante verde \"Convalida risposta\". Tutte le risposte si accumulano: alla fine digitate il codice completo per sbloccare vittoria ed epilogo narrativo.",
  },
  'tutorial.s9.title': {
    fr: 'Bloque ? Demande de l aide', en: 'Stuck? Ask for help', de: 'Festgefahren? Hol dir Hilfe', es: 'Atascado? Pide ayuda', it: 'Bloccato? Chiedi aiuto',
  },
  'tutorial.s9.text': {
    fr: "Pas de panique. A chaque etape tu as plusieurs indices a ta disposition (icone ampoule en bas) qui te disent ou regarder et ce que tu cherches. Et si vraiment tu n'y arrives pas, tu peux passer l'etape (icone fleche) — la reponse te sera revelee et tu continues l'aventure. Le but c'est de profiter, pas de te bloquer.",
    en: "No panic. Each step has several hints at your disposal (bulb icon at the bottom) telling you where to look and what you're after. And if you truly cannot crack it, you can skip the step (arrow icon) — the answer is revealed and you continue the adventure. The point is enjoyment, not getting stuck.",
    de: "Keine Panik. Bei jedem Schritt hast du mehrere Hinweise (Gluhbirnen-Symbol unten), die dir sagen, wo zu schauen und was zu suchen ist. Und wenn du wirklich nicht weiterkommst, kannst du die Etappe uberspringen (Pfeil-Symbol) — die Antwort wird enthullt und du setzt das Abenteuer fort. Es geht um Spass, nicht ums Festhangen.",
    es: "Sin panico. En cada etapa tienes varias pistas a tu disposicion (icono bombilla abajo) que te dicen donde mirar y que buscar. Y si de verdad no lo consigues, puedes saltar la etapa (icono flecha) — la respuesta se revela y sigues con la aventura. El objetivo es disfrutar, no quedarse atascado.",
    it: "Nessun panico. Ad ogni tappa hai piu indizi a disposizione (icona lampadina in basso) che ti dicono dove guardare e cosa cerchi. E se davvero non ce la fai, puoi saltare la tappa (icona freccia) — la risposta viene rivelata e continui l'avventura. Lo scopo e divertirsi, non rimanere bloccati.",
  },
  'tutorial.s10.title': {
    fr: 'Victoire, selfie et classement', en: 'Victory, selfie and leaderboard', de: 'Sieg, Selfie und Rangliste', es: 'Victoria, selfie y clasificacion', it: 'Vittoria, selfie e classifica',
  },
  'tutorial.s10.text': {
    fr: "Apres la 8e enigme resolue, vous decouvrez l'epilogue narratif (la verite revelee), votre place au classement general (moins de penalites = meilleur score), et un selfie souvenir auto-genere pour partager votre exploit sur les reseaux. Profitez du moment : vous avez explore une ville comme personne.",
    en: "After the 8th riddle is solved, you discover the narrative epilogue (the truth revealed), your place on the global leaderboard (fewer penalties = better score), and an auto-generated keepsake selfie to share your exploit on social media. Enjoy the moment: you've explored a city like no one else.",
    de: 'Nach dem 8. gelosten Ratsel entdecken Sie den narrativen Epilog (die enthullte Wahrheit), Ihren Platz in der globalen Rangliste (weniger Strafen = bessere Punktzahl) und ein automatisch generiertes Erinnerungs-Selfie zum Teilen in sozialen Medien. Geniessen Sie den Moment: Sie haben eine Stadt erkundet wie kein anderer.',
    es: 'Despues del 8o enigma resuelto, descubres el epilogo narrativo (la verdad revelada), tu puesto en la clasificacion global (menos penalizaciones = mejor puntuacion), y un selfie de recuerdo auto-generado para compartir en redes. Disfruta el momento: has explorado una ciudad como nadie.',
    it: "Dopo l'ottavo enigma risolto, scoprite l'epilogo narrativo (la verita rivelata), il vostro posto nella classifica globale (meno penalita = punteggio migliore), e un selfie ricordo auto-generato da condividere sui social. Godetevi il momento: avete esplorato una citta come nessun altro.",
  },
  'tutorial.s11.title': {
    fr: 'Restez en securite', en: 'Stay safe', de: 'Bleiben Sie sicher', es: 'Mantente seguro', it: 'Restate in sicurezza',
  },
  'tutorial.s11.text': {
    fr: "Le jeu se passe dans la rue : levez la tete entre deux scans, evitez de marcher en regardant la camera, traversez UNIQUEMENT aux passages pietons. Le parcours a ete trace pour rester dans un meme quartier, mais soyez attentifs aux velos, voitures et trottinettes. En cas d'urgence, le 112 marche partout en Europe.",
    en: "The game happens on the street: look up between scans, don't walk while staring at the camera, cross ONLY at pedestrian crossings. The route stays in one neighbourhood by design, but watch out for bikes, cars and scooters. Emergency number 112 works across Europe.",
    de: "Das Spiel findet auf der Strasse statt: Schauen Sie zwischen Scans hoch, gehen Sie nicht, wahrend Sie auf die Kamera starren, uberqueren Sie NUR an Fusgangeruberwegen. Die Route bleibt im selben Viertel, aber achten Sie auf Fahrrader, Autos und Roller. Notrufnummer 112 funktioniert europaweit.",
    es: "El juego ocurre en la calle: levanta la cabeza entre escaneos, no camines mirando la camara, cruza SOLO por pasos de peatones. El recorrido se queda en un solo barrio por diseno, pero atento a bicis, coches y patinetes. El 112 funciona en toda Europa.",
    it: "Il gioco si svolge per strada: alzate la testa tra una scansione e l'altra, non camminate guardando la fotocamera, attraversate SOLO sulle strisce pedonali. Il percorso resta in uno stesso quartiere per scelta, ma fate attenzione a bici, auto e monopattini. Il 112 funziona in tutta Europa.",
  },

  // Play page - Briefing
  'play.steps': {
    fr: 'etapes', en: 'steps', de: 'Schritte', es: 'etapas', it: 'tappe',
  },
  'play.scenario': {
    fr: 'Scenario', en: 'Scenario', de: 'Szenario', es: 'Escenario', it: 'Scenario',
  },
  'play.startingPoint': {
    fr: 'Point de rendez-vous', en: 'Rendez-vous point', de: 'Treffpunkt', es: 'Punto de encuentro', it: 'Punto d\'incontro',
  },
  'play.startingPointDesc': {
    fr: 'Retrouvez-nous a ce point pour debuter. De la, votre premiere etape se trouvera a quelques minutes de marche — votre boussole AR vous guidera des le depart.',
    en: 'Meet us at this point to begin. From there, your first stop will be a few minutes\' walk away — your AR compass will guide you from the start.',
    de: 'Treffen Sie uns an diesem Punkt. Von dort aus ist Ihr erster Stopp ein paar Gehminuten entfernt — Ihr AR-Kompass leitet Sie von Anfang an.',
    es: 'Encuentrate con nosotros en este punto. Desde ahi, tu primera parada estara a unos minutos a pie — tu brujula AR te guiara desde el inicio.',
    it: 'Raggiungici a questo punto. Da li, la tua prima tappa sara a qualche minuto a piedi — la tua bussola AR ti guidera fin dall\'inizio.',
  },
  'play.startingPointDirection': {
    fr: 'Direction du point de rendez-vous', en: 'Direction to rendez-vous', de: 'Richtung zum Treffpunkt', es: 'Direccion al punto de encuentro', it: 'Direzione al punto d\'incontro',
  },
  'play.letsGo': {
    fr: 'C\'est parti !', en: 'Let\'s go!', de: 'Los geht\'s!', es: 'Vamos!', it: 'Andiamo!',
  },
  'play.skipVideo': {
    fr: 'Passer la video', en: 'Skip video', de: 'Video uberspringen', es: 'Saltar video', it: 'Salta il video',
  },
  'play.gpsActivating': {
    fr: 'Activation du GPS en cours...', en: 'GPS activating...', de: 'GPS wird aktiviert...', es: 'Activando GPS...', it: 'Attivazione GPS...',
  },

  // Play page - Active game
  'play.step': {
    fr: 'Etape', en: 'Step', de: 'Schritt', es: 'Etapa', it: 'Tappa',
  },
  'play.targetDirection': {
    fr: 'Direction de l\'objectif', en: 'Direction to target', de: 'Richtung zum Ziel', es: 'Direccion al objetivo', it: 'Direzione all\'obiettivo',
  },
  'play.arMode': {
    fr: 'Mode RA', en: 'AR mode', de: 'AR-Modus', es: 'Modo RA', it: 'Modalita AR',
  },
  'play.arModeDesc': {
    fr: 'Suivre la fleche avec la camera', en: 'Follow the arrow with the camera', de: 'Folgen Sie dem Pfeil mit der Kamera', es: 'Seguir la flecha con la camara', it: 'Segui la freccia con la fotocamera',
  },
  'play.arIntroTitle': {
    fr: 'Nouveau : mode realite augmentee',
    en: 'New: augmented reality mode',
    de: 'Neu: Augmented-Reality-Modus',
    es: 'Nuevo: modo realidad aumentada',
    it: 'Nuovo: modalita realta aumentata',
  },
  'play.arIntroBadge': {
    fr: 'Nouveau', en: 'New', de: 'Neu', es: 'Nuevo', it: 'Nuovo',
  },
  'play.arIntroDesc': {
    fr: 'Pendant le jeu, touchez le bouton "Mode RA" sur la carte pour ouvrir votre camera. Un marqueur flottant s\'ancre dans l\'espace a la position de votre objectif, un mini-radar en haut a gauche affiche sa direction sur 360°, et les anneaux de couleur indiquent la proximite. Quand vous etes aligne et proche, votre telephone vibre : cible verrouillee.',
    en: 'During the game, tap the "AR mode" button on the map to open your camera. A floating marker is pinned in space at your target location, a mini-radar in the top-left shows its direction across 360°, and coloured rings indicate proximity. When you\'re lined up and close, your phone vibrates: target locked.',
    de: 'Tippen Sie wahrend des Spiels auf der Karte auf "AR-Modus", um die Kamera zu offnen. Ein schwebender Marker wird im Raum an der Position Ihres Ziels verankert, ein Mini-Radar oben links zeigt die Richtung auf 360°, und farbige Ringe zeigen die Nahe. Wenn Sie ausgerichtet und nah sind, vibriert Ihr Telefon: Ziel erfasst.',
    es: 'Durante el juego, pulsa el boton "Modo RA" en el mapa para abrir la camara. Un marcador flotante se ancla en el espacio en la posicion del objetivo, un mini radar arriba a la izquierda muestra su direccion en 360° y los anillos de colores indican la proximidad. Cuando estas alineado y cerca, el telefono vibra: objetivo fijado.',
    it: 'Durante il gioco, tocca il pulsante "Modalita AR" sulla mappa per aprire la fotocamera. Un marcatore fluttuante viene ancorato nello spazio alla posizione del tuo obiettivo, un mini-radar in alto a sinistra ne mostra la direzione a 360° e gli anelli colorati indicano la prossimita. Quando sei allineato e vicino, il telefono vibra: obiettivo agganciato.',
  },
  // ── Refonte pédagogique AR 2026-05-23 post-refund Cuenca ──
  // Vulgarisation : "réalité augmentée" → "caméra magique". 3 étapes
  // simples + reassurance permissions. Le mot "RA/AR" disparaît du
  // titre pour ne pas perdre les gens qui ne savent pas ce que c'est.
  'play.arEduTitle': {
    fr: 'La camera magique du jeu',
    en: 'The game\'s magic camera',
    de: 'Die magische Kamera des Spiels',
    es: 'La camara magica del juego',
    it: 'La fotocamera magica del gioco',
  },
  'play.arEduDesc': {
    fr: 'Sur chaque lieu, un mot cache apparait sur le mur quand vous pointez la camera de votre telephone vers la facade. Pas besoin d\'installer une appli — c\'est integre au jeu.',
    en: 'At each spot, a hidden word appears on the wall when you point your phone\'s camera at the facade. No app to install — it\'s built into the game.',
    de: 'An jedem Ort erscheint ein verstecktes Wort auf der Wand, wenn Sie die Kamera Ihres Telefons auf die Fassade richten. Keine App-Installation notig — alles ist im Spiel integriert.',
    es: 'En cada lugar, una palabra oculta aparece en la pared cuando apuntas la camara de tu telefono a la fachada. No necesitas instalar nada — todo esta integrado en el juego.',
    it: 'In ogni punto, una parola nascosta appare sul muro quando punti la fotocamera del telefono verso la facciata. Nessuna app da installare — e tutto integrato nel gioco.',
  },
  'play.arStep1': {
    fr: 'Marchez jusqu\'au lieu indique',
    en: 'Walk to the marked spot',
    de: 'Gehen Sie zum markierten Ort',
    es: 'Camina hasta el lugar indicado',
    it: 'Cammina fino al luogo indicato',
  },
  'play.arStep2': {
    fr: 'Touchez le bouton violet "Mode AR"',
    en: 'Tap the purple "AR mode" button',
    de: 'Tippen Sie auf den violetten "AR-Modus"-Button',
    es: 'Pulsa el boton violeta "Modo AR"',
    it: 'Tocca il pulsante viola "Modalita AR"',
  },
  'play.arStep3': {
    fr: 'Pointez la camera vers la facade',
    en: 'Point the camera at the facade',
    de: 'Richten Sie die Kamera auf die Fassade',
    es: 'Apunta la camara a la fachada',
    it: 'Punta la fotocamera verso la facciata',
  },
  'play.arPermissionHint': {
    fr: 'Votre telephone vous demandera l\'autorisation d\'utiliser la camera et la boussole. Acceptez les deux pour profiter du jeu — rien n\'est enregistre, tout reste sur votre appareil.',
    en: 'Your phone will ask permission to use the camera and the compass. Accept both to enjoy the game — nothing is recorded, everything stays on your device.',
    de: 'Ihr Telefon wird Sie um Erlaubnis bitten, die Kamera und den Kompass zu verwenden. Akzeptieren Sie beides, um das Spiel zu geniessen — nichts wird aufgezeichnet, alles bleibt auf Ihrem Gerat.',
    es: 'Tu telefono pedira permiso para usar la camara y la brujula. Acepta ambos para disfrutar del juego — nada se graba, todo queda en tu dispositivo.',
    it: 'Il tuo telefono chiedera il permesso di usare la fotocamera e la bussola. Accetta entrambi per goderti il gioco — nulla viene registrato, tutto resta sul tuo dispositivo.',
  },
  'play.heading': {
    fr: 'Direction', en: 'Heading to', de: 'Richtung', es: 'Direccion', it: 'Direzione',
  },
  'play.distanceToTarget': {
    fr: 'Distance jusqu\'au lieu',
    en: 'Distance to the spot',
    de: 'Entfernung zum Ort',
    es: 'Distancia hasta el lugar',
    it: 'Distanza dal luogo',
  },
  'play.openInMaps': {
    fr: 'Ouvrir dans Maps',
    en: 'Open in Maps',
    de: 'In Maps offnen',
    es: 'Abrir en Maps',
    it: 'Apri in Maps',
  },
  // ── GPS tracking disclosure (2026-05-23, post-Bibinouze) ──
  'play.gpsTrackingTitle': {
    fr: 'Suivi GPS du parcours — confidentialite',
    en: 'GPS route tracking — privacy',
    de: 'GPS-Routenverfolgung — Datenschutz',
    es: 'Seguimiento GPS del recorrido — privacidad',
    it: 'Tracciamento GPS del percorso — privacy',
  },
  'play.gpsTrackingDesc': {
    fr: 'Pour vous aider en direct si vous etes perdu et ameliorer le jeu, votre position GPS est enregistree pendant la partie (toutes les 30 sec). Les donnees sont liees uniquement a votre session anonyme (aucun nom, aucun email), conservees 30 jours puis automatiquement supprimees. Conforme RGPD.',
    en: 'To help you live if you are lost and improve the game, your GPS position is recorded during the game (every 30 sec). Data is linked only to your anonymous session (no name, no email), kept 30 days then automatically deleted. GDPR compliant.',
    de: 'Um Ihnen live zu helfen, wenn Sie verloren gehen, und das Spiel zu verbessern, wird Ihre GPS-Position wahrend des Spiels (alle 30 Sek.) aufgezeichnet. Die Daten sind nur mit Ihrer anonymen Sitzung verknupft (kein Name, keine E-Mail), werden 30 Tage aufbewahrt und dann automatisch geloscht. DSGVO-konform.',
    es: 'Para ayudarte en vivo si te pierdes y mejorar el juego, tu posicion GPS se registra durante la partida (cada 30 seg). Los datos solo se vinculan a tu sesion anonima (sin nombre, sin email), se conservan 30 dias y luego se eliminan automaticamente. Conforme al RGPD.',
    it: 'Per aiutarti in diretta se ti perdi e migliorare il gioco, la tua posizione GPS viene registrata durante la partita (ogni 30 sec). I dati sono collegati solo alla tua sessione anonima (nessun nome, nessuna email), conservati 30 giorni e poi automaticamente eliminati. Conforme al GDPR.',
  },
  'ar.label': {
    fr: 'Realite augmentee', en: 'Augmented reality', de: 'Augmented Reality', es: 'Realidad aumentada', it: 'Realta aumentata',
  },
  'ar.close': {
    fr: 'Fermer', en: 'Close', de: 'Schliessen', es: 'Cerrar', it: 'Chiudi',
  },
  'ar.cameraError': {
    fr: 'Impossible d\'acceder a la camera. Verifiez les permissions.', en: 'Unable to access the camera. Check permissions.', de: 'Kamera nicht verfugbar. Berechtigungen prufen.', es: 'No se puede acceder a la camara. Verifica los permisos.', it: 'Impossibile accedere alla fotocamera. Verifica i permessi.',
  },
  'ar.enableCompass': {
    fr: 'Activez la boussole pour suivre la direction', en: 'Enable the compass to follow the direction', de: 'Kompass aktivieren, um der Richtung zu folgen', es: 'Activa la brujula para seguir la direccion', it: 'Attiva la bussola per seguire la direzione',
  },
  'ar.activate': {
    fr: 'Activer', en: 'Activate', de: 'Aktivieren', es: 'Activar', it: 'Attiva',
  },
  'ar.waitingGps': {
    fr: 'En attente du signal GPS...', en: 'Waiting for GPS signal...', de: 'Warte auf GPS-Signal...', es: 'Esperando senal GPS...', it: 'In attesa del segnale GPS...',
  },
  'ar.movePhone': {
    fr: 'Bougez le telephone en forme de 8 pour calibrer la boussole', en: 'Move the phone in a figure 8 to calibrate the compass', de: 'Bewegen Sie das Telefon in einer 8 zum Kalibrieren des Kompasses', es: 'Mueve el telefono en forma de 8 para calibrar la brujula', it: 'Muovi il telefono a forma di 8 per calibrare la bussola',
  },
  'ar.distance': {
    fr: 'Distance', en: 'Distance', de: 'Entfernung', es: 'Distancia', it: 'Distanza',
  },
  'ar.bearing': {
    fr: 'Cap', en: 'Bearing', de: 'Kurs', es: 'Rumbo', it: 'Rotta',
  },
  'ar.turn': {
    fr: 'Ecart', en: 'Offset', de: 'Abweichung', es: 'Desvio', it: 'Scarto',
  },
  'ar.turnLeft': {
    fr: 'A gauche', en: 'Turn left', de: 'Links', es: 'Izquierda', it: 'Sinistra',
  },
  'ar.turnRight': {
    fr: 'A droite', en: 'Turn right', de: 'Rechts', es: 'Derecha', it: 'Destra',
  },
  'ar.radar': {
    fr: 'Radar', en: 'Radar', de: 'Radar', es: 'Radar', it: 'Radar',
  },
  'ar.zone': {
    fr: 'Zone', en: 'Zone', de: 'Zone', es: 'Zona', it: 'Zona',
  },
  'ar.zoneVeryClose': {
    fr: 'Tout pres', en: 'Very close', de: 'Sehr nah', es: 'Muy cerca', it: 'Molto vicino',
  },
  'ar.zoneClose': {
    fr: 'Proche', en: 'Close', de: 'Nah', es: 'Cerca', it: 'Vicino',
  },
  'ar.zoneMedium': {
    fr: 'Moyen', en: 'Medium', de: 'Mittel', es: 'Medio', it: 'Medio',
  },
  'ar.zoneFar': {
    fr: 'Loin', en: 'Far', de: 'Weit', es: 'Lejos', it: 'Lontano',
  },
  'ar.zoneVeryFar': {
    fr: 'Tres loin', en: 'Very far', de: 'Sehr weit', es: 'Muy lejos', it: 'Molto lontano',
  },
  'ar.lockedOn': {
    fr: 'Cible verrouillee !', en: 'Target locked!', de: 'Ziel erfasst!', es: 'Objetivo fijado!', it: 'Obiettivo agganciato!',
  },
  'play.validateGps': {
    fr: 'Valider GPS', en: 'Validate GPS', de: 'GPS bestatigen', es: 'Validar GPS', it: 'Valida GPS',
  },
  'play.stepValidated': {
    fr: 'Etape validee !', en: 'Step validated!', de: 'Schritt bestatigt!', es: 'Etapa validada!', it: 'Tappa validata!',
  },
  'play.noteAnswer': {
    fr: 'Notez votre reponse', en: 'Note your answer', de: 'Notieren Sie Ihre Antwort', es: 'Anota tu respuesta', it: 'Annota la tua risposta',
  },
  'play.answerPlaceholder': {
    fr: 'Votre reponse pour cette etape...', en: 'Your answer for this step...', de: 'Ihre Antwort fur diesen Schritt...', es: 'Tu respuesta para esta etapa...', it: 'La tua risposta per questa tappa...',
  },
  'play.nextStep': {
    fr: 'Etape suivante', en: 'Next step', de: 'Nachster Schritt', es: 'Siguiente etapa', it: 'Prossima tappa',
  },
  'play.stepSkipped': {
    fr: 'Etape passee — voici la reponse', en: 'Step skipped — here is the answer', de: 'Schritt ubersprungen — hier ist die Antwort', es: 'Etapa saltada — aqui esta la respuesta', it: 'Tappa saltata — ecco la risposta',
  },
  'play.answerWas': {
    fr: 'La reponse etait :', en: 'The answer was:', de: 'Die Antwort war:', es: 'La respuesta era:', it: 'La risposta era:',
  },
  'play.correctAnswerLabel': {
    fr: 'La bonne reponse etait :', en: 'The correct answer was:', de: 'Die richtige Antwort war:', es: 'La respuesta correcta era:', it: 'La risposta corretta era:',
  },
  'play.understood': {
    fr: 'J\'ai compris, en route !', en: 'Got it, let\'s go!', de: 'Verstanden, los geht\'s!', es: 'Entendido, vamos!', it: 'Capito, andiamo!',
  },
  'play.reviewRiddle': {
    fr: 'Revoir l\'enigme', en: 'Review riddle', de: 'Ratsel nochmal lesen', es: 'Revisar enigma', it: 'Rivedere l\'enigma',
  },
  'play.didYouKnow': {
    fr: 'Le saviez-vous ?', en: 'Did you know?', de: 'Wussten Sie?', es: 'Sabias que?', it: 'Lo sapevate?',
  },
  // Vision client 2026-05-16 — clés UI patrimoine-first
  'play.yourGuide': {
    fr: 'Votre guide', en: 'Your guide', de: 'Ihr Reiseführer', es: 'Su guía', it: 'La vostra guida',
  },
  'play.theStory': {
    fr: "L'histoire du lieu", en: "The story of this place", de: 'Die Geschichte des Ortes', es: 'La historia del lugar', it: 'La storia del luogo',
  },
  'play.onYourWay': {
    fr: 'Sur le chemin vers le prochain stop',
    en: 'On your way to the next stop',
    de: 'Auf dem Weg zur nächsten Station',
    es: 'En el camino a la próxima parada',
    it: 'Sulla strada per la prossima tappa',
  },
  'play.guideNotebookSaved': {
    fr: "Je l'ai ajoutée à votre carnet pour l'énigme finale. Continuons l'aventure ensemble.",
    en: "I've added it to your notebook for the final riddle. Let's continue the adventure together.",
    de: "Ich habe es in dein Notizbuch für das letzte Rätsel eingetragen. Lass uns das Abenteuer gemeinsam fortsetzen.",
    es: "La he añadido a su cuaderno para el acertijo final. Continuemos juntos la aventura.",
    it: "L'ho aggiunta al vostro taccuino per l'enigma finale. Continuiamo l'avventura insieme.",
  },
  'play.guideNotebookAdded': {
    fr: 'Ajouté à votre carnet pour l\'énigme finale. Continuons l\'aventure !',
    en: 'Added to your notebook for the final riddle. Let\'s continue the adventure!',
    de: 'Zu deinem Notizbuch für das letzte Rätsel hinzugefügt. Lass uns das Abenteuer fortsetzen!',
    es: '¡Añadido a su cuaderno para el acertijo final. Continuemos la aventura!',
    it: 'Aggiunto al vostro taccuino per l\'enigma finale. Continuiamo l\'avventura!',
  },
  'play.guideNotFound': {
    fr: "Vous n'avez pas trouvé l'indice — c'est pas grave",
    en: "You didn't find the clue — no worries",
    de: 'Du hast den Hinweis nicht gefunden — kein Problem',
    es: 'No encontró la pista — no se preocupe',
    it: "Non avete trovato l'indizio — nessun problema",
  },
  'play.guideAnswerReveal': {
    fr: 'La réponse était :',
    en: 'The answer was:',
    de: 'Die Antwort war:',
    es: 'La respuesta era:',
    it: 'La risposta era:',
  },
  'play.guideCongrats': {
    fr: "Bravo, vous avez trouvé l'indice !",
    en: 'Well done, you found the clue!',
    de: 'Gut gemacht, du hast den Hinweis gefunden!',
    es: '¡Bravo, encontró la pista!',
    it: "Bravo, avete trovato l'indizio!",
  },
  'play.theGuideSays': {
    fr: 'Le guide vous parle',
    en: 'The guide speaks to you',
    de: 'Der Reiseführer spricht zu dir',
    es: 'Su guía les habla',
    it: 'La guida vi parla',
  },
  'play.attemptsRemaining': {
    fr: 'Essais restants',
    en: 'Attempts remaining',
    de: 'Verbleibende Versuche',
    es: 'Intentos restantes',
    it: 'Tentativi rimanenti',
  },
  'play.finalSuccess': {
    fr: 'Bravo, vous avez trouvé !',
    en: 'Bravo, you found it!',
    de: 'Bravo, du hast es gefunden!',
    es: '¡Bravo, lo encontró!',
    it: 'Bravo, l\'avete trovato!',
  },
  'play.finalRevealed': {
    fr: 'La réponse était...',
    en: 'The answer was...',
    de: 'Die Antwort war...',
    es: 'La respuesta era...',
    it: 'La risposta era...',
  },
  'play.puzzleWrong': {
    fr: "Ce n'est pas la bonne réponse — réessayez, ou prenez un indice.",
    en: "That's not it — try again, or take a hint.",
    de: 'Das ist nicht richtig — versuch es erneut oder nimm einen Hinweis.',
    es: 'No es correcto — inténtalo de nuevo o pide una pista.',
    it: 'Non è la risposta giusta — riprova o usa un indizio.',
  },
  'play.decipher': {
    fr: "Déchiffre l'énigme",
    en: 'Decipher the puzzle',
    de: 'Entschlüssle das Rätsel',
    es: 'Descifra el enigma',
    it: "Decifra l'enigma",
  },
  'play.arRevealed': {
    fr: "L'RA a dévoilé",
    en: 'AR revealed',
    de: 'AR enthüllte',
    es: 'La RA reveló',
    it: "L'AR ha svelato",
  },
  'play.yourAnswer': {
    fr: 'Ta réponse…',
    en: 'Your answer…',
    de: 'Deine Antwort…',
    es: 'Tu respuesta…',
    it: 'La tua risposta…',
  },
  'play.validate': {
    fr: 'Valider',
    en: 'Submit',
    de: 'Bestätigen',
    es: 'Validar',
    it: 'Conferma',
  },
  'play.hintPenalty': {
    fr: 'Indice (pénalité)',
    en: 'Hint (penalty)',
    de: 'Hinweis (Strafe)',
    es: 'Pista (penalización)',
    it: 'Indizio (penalità)',
  },
  'play.skipPenalty': {
    fr: "Passer l'énigme (pénalité)",
    en: 'Skip puzzle (penalty)',
    de: 'Rätsel überspringen (Strafe)',
    es: 'Saltar enigma (penalización)',
    it: 'Salta enigma (penalità)',
  },
  'play.audioNotice': {
    fr: "Ce jeu se joue en audio. Vérifie que ton téléphone n'est PAS en mode silencieux et monte le volume 🔊",
    en: "This game is audio-based. Make sure your phone is NOT on silent and turn the volume up 🔊",
    de: "Dieses Spiel ist audiobasiert. Stelle sicher, dass dein Handy NICHT stumm ist, und dreh die Lautstärke auf 🔊",
    es: "Este juego es en audio. Asegúrate de que tu teléfono NO esté en silencio y sube el volumen 🔊",
    it: "Questo gioco è basato sull'audio. Assicurati che il telefono NON sia in silenzioso e alza il volume 🔊",
  },
  // ── Aide in-game (Phase 1) : bouton SOS + FAQ offline + contact ──
  'play.helpButton': {
    fr: "Besoin d'aide ?", en: "Need help?", de: "Brauchst du Hilfe?", es: "¿Necesitas ayuda?", it: "Serve aiuto?",
  },
  'play.helpTitle': {
    fr: "Aide & contact", en: "Help & contact", de: "Hilfe & Kontakt", es: "Ayuda y contacto", it: "Aiuto e contatti",
  },
  'play.helpSubtitle': {
    fr: "Réponses immédiates ci-dessous, ou écris-nous.",
    en: "Instant answers below, or write to us.",
    de: "Sofort-Antworten unten, oder schreib uns.",
    es: "Respuestas inmediatas abajo, o escríbenos.",
    it: "Risposte immediate qui sotto, o scrivici.",
  },
  'play.helpFaqTitle': {
    fr: "Questions fréquentes", en: "Frequently asked", de: "Häufige Fragen", es: "Preguntas frecuentes", it: "Domande frequenti",
  },
  'play.faqAudioQ': {
    fr: "Je n'ai aucun son", en: "I have no sound", de: "Ich habe keinen Ton", es: "No tengo sonido", it: "Non ho audio",
  },
  'play.faqAudioA': {
    fr: "Vérifie que ton téléphone n'est PAS en mode silencieux (le petit interrupteur sur le côté de l'iPhone) et monte le volume. Le jeu est audio : c'est la cause n°1 d'absence de son.",
    en: "Make sure your phone is NOT on silent (the little switch on the side of an iPhone) and turn the volume up. The game is audio-based — this is the #1 cause of no sound.",
    de: "Stelle sicher, dass dein Handy NICHT auf lautlos steht (der kleine Schalter an der iPhone-Seite) und dreh die Lautstärke auf. Das Spiel ist audiobasiert — das ist Ursache Nr. 1 für fehlenden Ton.",
    es: "Asegúrate de que tu teléfono NO esté en silencio (el pequeño interruptor lateral del iPhone) y sube el volumen. El juego es de audio: es la causa nº1 de que no haya sonido.",
    it: "Assicurati che il telefono NON sia in silenzioso (il piccolo interruttore sul lato dell'iPhone) e alza il volume. Il gioco è basato sull'audio: è la causa n.1 di assenza di suono.",
  },
  'play.faqTicketQ': {
    fr: "Dois-je payer une entrée ?", en: "Do I need to pay to enter?", de: "Muss ich Eintritt zahlen?", es: "¿Tengo que pagar entrada?", it: "Devo pagare un ingresso?",
  },
  'play.faqTicketA': {
    fr: "Non, jamais. Tout se joue depuis la rue : rien de payant n'est nécessaire pour avancer. Certaines visites payantes sont un bonus facultatif, pas une obligation.",
    en: "No, never. Everything is played from the street — nothing paid is needed to progress. Some paid tours are an optional bonus, never required.",
    de: "Nein, nie. Alles wird von der Straße aus gespielt — nichts Kostenpflichtiges ist zum Weiterkommen nötig. Kostenpflichtige Führungen sind ein optionaler Bonus.",
    es: "No, nunca. Todo se juega desde la calle: no necesitas pagar nada para avanzar. Algunas visitas de pago son un extra opcional, nunca obligatorio.",
    it: "No, mai. Tutto si gioca dalla strada: non serve pagare nulla per proseguire. Alcune visite a pagamento sono un extra facoltativo, mai obbligatorio.",
  },
  'play.faqGpsQ': {
    fr: "Je suis sur place mais rien ne se passe", en: "I'm at the spot but nothing happens", de: "Ich bin am Ort, aber nichts passiert", es: "Estoy en el sitio pero no pasa nada", it: "Sono sul posto ma non succede nulla",
  },
  'play.faqGpsA': {
    fr: "Attends quelques secondes que le GPS se cale, ou fais quelques pas. Tu peux aussi ouvrir « Mode AR » et saisir directement ta réponse : elle se déduit de l'audio, tu n'as pas besoin d'être pile sur le point.",
    en: "Wait a few seconds for GPS to settle, or take a few steps. You can also open \"AR mode\" and type your answer directly: it can be deduced from the audio, you don't need to be exactly on the spot.",
    de: "Warte ein paar Sekunden, bis sich das GPS einpendelt, oder geh ein paar Schritte. Du kannst auch den \"AR-Modus\" öffnen und deine Antwort direkt eingeben: Sie lässt sich aus dem Audio ableiten, du musst nicht exakt am Punkt stehen.",
    es: "Espera unos segundos a que el GPS se estabilice, o da unos pasos. También puedes abrir el \"Modo AR\" y escribir tu respuesta directamente: se deduce del audio, no hace falta estar justo en el punto.",
    it: "Aspetta qualche secondo che il GPS si stabilizzi, o fai qualche passo. Puoi anche aprire la \"Modalità AR\" e digitare la risposta: si deduce dall'audio, non devi essere esattamente sul punto.",
  },
  'play.faqHintsQ': {
    fr: "Comment marchent les indices et « passer » ?", en: "How do hints and \"skip\" work?", de: "Wie funktionieren Hinweise und \"Überspringen\"?", es: "¿Cómo funcionan las pistas y \"saltar\"?", it: "Come funzionano indizi e \"salta\"?",
  },
  'play.faqHintsA': {
    fr: "Le bouton indice te donne un coup de pouce (petite pénalité de temps). Si tu bloques vraiment, « passer » débloque l'étape suivante avec une pénalité plus grande — tu peux toujours finir le jeu.",
    en: "The hint button gives you a nudge (small time penalty). If you're really stuck, \"skip\" unlocks the next step with a bigger penalty — you can always finish the game.",
    de: "Der Hinweis-Button gibt dir einen Schubs (kleine Zeitstrafe). Wenn du wirklich feststeckst, schaltet \"Überspringen\" den nächsten Schritt mit größerer Strafe frei — du kannst das Spiel immer beenden.",
    es: "El botón de pista te da un empujón (pequeña penalización de tiempo). Si te atascas de verdad, \"saltar\" desbloquea el siguiente paso con más penalización: siempre puedes terminar el juego.",
    it: "Il pulsante indizio ti dà una spinta (piccola penalità di tempo). Se sei davvero bloccato, \"salta\" sblocca il passo successivo con una penalità maggiore: puoi sempre finire il gioco.",
  },
  'play.faqPauseQ': {
    fr: "Puis-je faire une pause ?", en: "Can I take a break?", de: "Kann ich eine Pause machen?", es: "¿Puedo hacer una pausa?", it: "Posso fare una pausa?",
  },
  'play.faqPauseA': {
    fr: "Oui, à tout moment. Prends un café, déjeune, souffle : ta progression est sauvegardée. Reprends simplement là où tu t'es arrêté quand tu veux.",
    en: "Yes, anytime. Grab a coffee, have lunch, catch your breath: your progress is saved. Just resume where you left off whenever you like.",
    de: "Ja, jederzeit. Trink einen Kaffee, iss zu Mittag, hol Luft: Dein Fortschritt wird gespeichert. Mach einfach weiter, wo du aufgehört hast.",
    es: "Sí, cuando quieras. Tómate un café, come, respira: tu progreso se guarda. Retoma donde lo dejaste cuando quieras.",
    it: "Sì, quando vuoi. Prendi un caffè, pranza, riprendi fiato: i tuoi progressi sono salvati. Riparti da dove eri quando vuoi.",
  },
  'play.helpContactTitle': {
    fr: "Toujours besoin d'aide ? Écris-nous", en: "Still need help? Write to us", de: "Noch Hilfe nötig? Schreib uns", es: "¿Aún necesitas ayuda? Escríbenos", it: "Serve ancora aiuto? Scrivici",
  },
  'play.helpContactHint': {
    fr: "On reçoit ton message en direct et on te répond ici même dans le jeu.",
    en: "We get your message live and reply right here in the game.",
    de: "Wir erhalten deine Nachricht live und antworten direkt hier im Spiel.",
    es: "Recibimos tu mensaje en directo y te respondemos aquí mismo en el juego.",
    it: "Riceviamo il tuo messaggio in diretta e ti rispondiamo qui nel gioco.",
  },
  'play.helpPlaceholder': {
    fr: "Décris ton problème…", en: "Describe your problem…", de: "Beschreibe dein Problem…", es: "Describe tu problema…", it: "Descrivi il problema…",
  },
  'play.helpSend': {
    fr: "Envoyer", en: "Send", de: "Senden", es: "Enviar", it: "Invia",
  },
  'play.helpSending': {
    fr: "Envoi…", en: "Sending…", de: "Senden…", es: "Enviando…", it: "Invio…",
  },
  'play.helpSent': {
    fr: "Message envoyé ✓ On te répond vite.", en: "Message sent ✓ We'll reply soon.", de: "Nachricht gesendet ✓ Wir antworten bald.", es: "Mensaje enviado ✓ Te respondemos pronto.", it: "Messaggio inviato ✓ Ti rispondiamo presto.",
  },
  'play.helpQueuedOffline': {
    fr: "Pas de réseau — ton message part automatiquement dès que tu recaptes.",
    en: "Offline — your message will send automatically once you're back online.",
    de: "Offline — deine Nachricht wird automatisch gesendet, sobald du wieder online bist.",
    es: "Sin conexión: tu mensaje se enviará automáticamente cuando vuelvas a tener red.",
    it: "Offline — il messaggio verrà inviato automaticamente appena torni online.",
  },
  'play.helpError': {
    fr: "Envoi impossible. Réessaie dans un instant.", en: "Couldn't send. Try again in a moment.", de: "Senden fehlgeschlagen. Versuch es gleich nochmal.", es: "No se pudo enviar. Inténtalo en un momento.", it: "Invio non riuscito. Riprova tra poco.",
  },
  'play.noTicketNotice': {
    fr: "Aucune entrée payante n'est jamais nécessaire pour terminer l'aventure : tout ce dont tu as besoin s'observe depuis la rue. Certains lieux proposent des visites ou entrées payantes pour aller plus loin — c'est un bonus, jamais une obligation pour avancer.",
    en: "You never need to pay to enter anywhere to finish the adventure — everything you need is visible from the street. Some places offer paid tours or entry if you'd like to go deeper — that's a bonus, never required to progress.",
    de: "Um das Abenteuer abzuschließen, ist niemals ein kostenpflichtiger Eintritt nötig – alles, was du brauchst, ist von der Straße aus sichtbar. Manche Orte bieten kostenpflichtige Führungen oder Eintritte an – ein Bonus, aber keine Pflicht, um weiterzukommen.",
    es: "Nunca necesitas pagar una entrada para terminar la aventura: todo lo que necesitas se ve desde la calle. Algunos lugares ofrecen visitas o entradas de pago para profundizar, pero es un extra, nunca una obligación para avanzar.",
    it: "Non serve mai pagare un ingresso per finire l'avventura: tutto ciò che ti serve è visibile dalla strada. Alcuni luoghi offrono visite o ingressi a pagamento per approfondire, ma è un extra, mai un obbligo per proseguire.",
  },
  // ── Statut téléchargement hors-ligne (anti-blocage réseau) ──
  'play.offlineReadyMsg': {
    fr: '✓ Jeu téléchargé — jouable hors-ligne',
    en: '✓ Game downloaded — playable offline',
    de: '✓ Spiel heruntergeladen — offline spielbar',
    es: '✓ Juego descargado — jugable sin conexión',
    it: '✓ Gioco scaricato — giocabile offline',
  },
  'play.offlineProgress': {
    fr: 'Téléchargement du jeu (pour jouer hors-ligne)…',
    en: 'Downloading the game (for offline play)…',
    de: 'Spiel wird heruntergeladen (für offline)…',
    es: 'Descargando el juego (para sin conexión)…',
    it: 'Scaricamento del gioco (per offline)…',
  },
  'play.offlineWarn': {
    fr: 'Reste connecté au wifi ou aux données jusqu’au ✓ vert avant de partir — sinon tu ne pourras pas continuer sans réseau.',
    en: 'Stay on wifi or mobile data until the green ✓ before you set off — otherwise you won’t be able to continue without a signal.',
    de: 'Bleib mit WLAN oder mobilen Daten verbunden, bis das grüne ✓ erscheint — sonst kannst du ohne Signal nicht weiterspielen.',
    es: 'Permanece con wifi o datos móviles hasta el ✓ verde antes de salir — si no, no podrás continuar sin señal.',
    it: 'Resta connesso al wifi o ai dati fino al ✓ verde prima di partire — altrimenti non potrai continuare senza segnale.',
  },
  'play.offlineConfirm': {
    fr: 'Le jeu n’est pas encore entièrement téléchargé. Si tu pars sans réseau, tu ne pourras pas continuer. Commencer quand même ?',
    en: 'The game isn’t fully downloaded yet. If you leave without a signal, you won’t be able to continue. Start anyway?',
    de: 'Das Spiel ist noch nicht vollständig heruntergeladen. Ohne Signal kannst du nicht weiterspielen. Trotzdem starten?',
    es: 'El juego aún no está descargado por completo. Si sales sin señal, no podrás continuar. ¿Empezar de todos modos?',
    it: 'Il gioco non è ancora scaricato del tutto. Se parti senza segnale non potrai continuare. Iniziare comunque?',
  },
  'play.supportLabel': {
    fr: 'Support', en: 'Support', de: 'Support', es: 'Soporte', it: 'Supporto',
  },
  'play.replyBtn': {
    fr: 'Répondre', en: 'Reply', de: 'Antworten', es: 'Responder', it: 'Rispondi',
  },
  'play.gotItThanks': {
    fr: 'Compris, merci', en: 'Got it, thanks', de: 'Verstanden, danke', es: 'Entendido, gracias', it: 'Capito, grazie',
  },
  'play.replyPlaceholder': {
    fr: 'Ta réponse au support…', en: 'Your reply to support…', de: 'Deine Antwort an den Support…', es: 'Tu respuesta al soporte…', it: 'La tua risposta al supporto…',
  },
  'play.sendBtn': {
    fr: 'Envoyer', en: 'Send', de: 'Senden', es: 'Enviar', it: 'Invia',
  },
  'play.sendingBtn': {
    fr: 'Envoi…', en: 'Sending…', de: 'Senden…', es: 'Enviando…', it: 'Invio…',
  },
  'play.sentBtn': {
    fr: 'Envoyé !', en: 'Sent!', de: 'Gesendet!', es: '¡Enviado!', it: 'Inviato!',
  },
  'play.closeBtn': {
    fr: 'Fermer', en: 'Close', de: 'Schließen', es: 'Cerrar', it: 'Chiudi',
  },
  'play.answerQuestion': {
    fr: 'À toi de répondre',
    en: 'Your answer',
    de: 'Deine Antwort',
    es: 'Tu respuesta',
    it: 'La tua risposta',
  },
  'play.aboutThisPlace': {
    fr: 'Ce lieu',
    en: 'This place',
    de: 'Dieser Ort',
    es: 'Este lugar',
    it: 'Questo luogo',
  },
  'play.arScanPrompt': {
    fr: 'Pointe ton téléphone vers la façade pour révéler les mots.',
    en: 'Point your phone at the facade to reveal the words.',
    de: 'Richte dein Handy auf die Fassade, um die Wörter zu enthüllen.',
    es: 'Apunta tu teléfono a la fachada para revelar las palabras.',
    it: 'Punta il telefono verso la facciata per rivelare le parole.',
  },
  'play.cantSeeWords': {
    fr: 'Je ne vois pas les mots',
    en: "I can't see the words",
    de: 'Ich sehe die Wörter nicht',
    es: 'No veo las palabras',
    it: 'Non vedo le parole',
  },
  'play.tryAgain': {
    fr: 'Pas tout à fait — il vous reste un essai',
    en: "Not quite — you have one attempt left",
    de: 'Nicht ganz — du hast noch einen Versuch',
    es: 'No del todo — le queda un intento',
    it: 'Non proprio — vi rimane un tentativo',
  },
  'play.selfieSuggestion': {
    fr: 'Et si vous immortalisiez votre aventure avec un selfie devant le dernier lieu ?',
    en: 'How about immortalizing your adventure with a selfie in front of the last place?',
    de: 'Wie wäre es, dein Abenteuer mit einem Selfie vor dem letzten Ort festzuhalten?',
    es: '¿Y si inmortalizara su aventura con un selfie frente al último lugar?',
    it: 'Che ne dite di immortalare la vostra avventura con un selfie davanti all\'ultimo luogo?',
  },
  'play.treasureRevealed': {
    fr: 'Tresor revele', en: 'Treasure revealed', de: 'Schatz enthullt', es: 'Tesoro revelado', it: 'Tesoro rivelato',
  },
  'play.preparingHint': {
    fr: "Preparation de l'indice...", en: "Preparing the hint...", de: "Hinweis wird vorbereitet...", es: "Preparando la pista...", it: "Preparazione dell'indizio...",
  },
  'play.preparingSkip': {
    fr: "Revelation de la reponse...", en: "Revealing the answer...", de: "Antwort wird enthullt...", es: "Revelando la respuesta...", it: "Rivelazione della risposta...",
  },
  'play.translationNote': {
    fr: 'Traduction en cours, quelques secondes...', en: 'Translating, just a few seconds...', de: 'Ubersetzen, einen Moment...', es: 'Traduciendo, unos segundos...', it: 'Traduzione in corso, qualche secondo...',
  },
  'play.transition.title': {
    fr: 'Preparation de la prochaine etape', en: 'Preparing the next step', de: 'Nachster Schritt wird vorbereitet', es: 'Preparando la proxima etapa', it: 'Preparazione della prossima tappa',
  },
  'play.transition.subtitle': {
    fr: "Cela peut prendre jusqu'a 30 secondes en fonction de votre langue.", en: 'This may take up to 30 seconds depending on your language.', de: 'Das kann je nach Sprache bis zu 30 Sekunden dauern.', es: 'Puede tardar hasta 30 segundos segun tu idioma.', it: 'Puo richiedere fino a 30 secondi a seconda della lingua.',
  },
  'play.transition.translating': {
    fr: "Traduction de l'enigme en cours...", en: 'Translating the riddle...', de: 'Das Ratsel wird ubersetzt...', es: 'Traduciendo el enigma...', it: "Traduzione dell'enigma in corso...",
  },
  'play.transition.preparingMap': {
    fr: 'Preparation de la carte et de la navigation...', en: 'Preparing the map and navigation...', de: 'Karte und Navigation werden vorbereitet...', es: 'Preparando el mapa y la navegacion...', it: 'Preparazione della mappa e della navigazione...',
  },
  'play.transition.almostThere': {
    fr: 'Presque pret, merci pour votre patience...', en: 'Almost there, thanks for your patience...', de: 'Fast fertig, danke fur Ihre Geduld...', es: 'Casi listo, gracias por tu paciencia...', it: 'Quasi pronto, grazie per la pazienza...',
  },
  'play.transition.notCrashed': {
    fr: "L'application n'a pas plante — la traduction est en cours.", en: "The app hasn't crashed — translation is in progress.", de: 'Die App ist nicht abgesturzt — die Ubersetzung lauft.', es: 'La app no se ha bloqueado — la traduccion esta en curso.', it: "L'app non si e bloccata — la traduzione e in corso.",
  },

  // Generic chrome
  'play.loading': {
    fr: 'Chargement de la partie...', en: 'Loading the game...', de: 'Spiel wird geladen...', es: 'Cargando la partida...', it: 'Caricamento della partita...',
  },
  'play.back': {
    fr: 'Retour', en: 'Back', de: 'Zuruck', es: 'Volver', it: 'Indietro',
  },
  'play.notebook.title': {
    fr: 'Mon carnet', en: 'My notebook', de: 'Mein Notizbuch', es: 'Mi cuaderno', it: 'Il mio taccuino',
  },
  'play.audio.listen': {
    fr: 'Ecouter', en: 'Listen', de: 'Anhoren', es: 'Escuchar', it: 'Ascolta',
  },
  'play.audio.stop': {
    fr: 'Arreter', en: 'Stop', de: 'Stoppen', es: 'Detener', it: 'Ferma',
  },
  'play.notebook.close': {
    fr: 'Fermer', en: 'Close', de: 'Schliessen', es: 'Cerrar', it: 'Chiudi',
  },

  // Temperature indicator (proximity to target)
  'play.temp.searching': {
    fr: 'Recherche...', en: 'Searching...', de: 'Suchen...', es: 'Buscando...', it: 'Ricerca...',
  },
  'play.temp.burning': {
    fr: 'Brulant !', en: 'Burning!', de: 'Brennt!', es: 'Ardiente!', it: 'Bollente!',
  },
  'play.temp.veryHot': {
    fr: 'Tres chaud', en: 'Very hot', de: 'Sehr heiss', es: 'Muy caliente', it: 'Molto caldo',
  },
  'play.temp.hot': {
    fr: 'Chaud', en: 'Hot', de: 'Heiss', es: 'Caliente', it: 'Caldo',
  },
  'play.temp.warm': {
    fr: 'Tiede', en: 'Warm', de: 'Warm', es: 'Tibio', it: 'Tiepido',
  },
  'play.temp.cold': {
    fr: 'Froid', en: 'Cold', de: 'Kalt', es: 'Frio', it: 'Freddo',
  },

  // Error toasts shown via setError() during play
  'play.error.typeAnswerFirst': {
    fr: 'Tape la reponse decouverte en RA avant de valider', en: 'Type the answer you found in AR before validating', de: 'Geben Sie die in AR gefundene Antwort vor der Validierung ein', es: 'Escribe la respuesta encontrada en RA antes de validar', it: 'Digita la risposta trovata in AR prima di convalidare',
  },
  'play.error.wrongAnswer': {
    fr: 'Reponse incorrecte. Verifie ce que tu as decouvert en RA.', en: 'Wrong answer. Check what you found in AR.', de: 'Falsche Antwort. Prufen Sie, was Sie in AR gefunden haben.', es: 'Respuesta incorrecta. Comprueba lo que encontraste en RA.', it: 'Risposta errata. Controlla cosa hai trovato in AR.',
  },
  'play.error.validationFailed': {
    fr: 'Validation echouee. Reessaie.', en: 'Validation failed. Try again.', de: 'Validierung fehlgeschlagen. Erneut versuchen.', es: 'Validacion fallida. Intentalo de nuevo.', it: 'Convalida fallita. Riprova.',
  },
  'play.error.validationGeneric': {
    fr: 'Erreur de validation', en: 'Validation error', de: 'Validierungsfehler', es: 'Error de validacion', it: 'Errore di convalida',
  },
  'play.error.hintFailed': {
    fr: "Erreur lors de la demande d'indice", en: 'Hint request failed', de: 'Hinweis-Anfrage fehlgeschlagen', es: 'Error al pedir la pista', it: 'Errore nella richiesta di indizio',
  },
  'play.error.skipFailed': {
    fr: "Erreur lors du passage de l'etape", en: 'Failed to skip the step', de: 'Etappe konnte nicht ubersprungen werden', es: 'Error al saltar la etapa', it: 'Errore nel saltare la tappa',
  },
  'play.error.startFailed': {
    fr: 'Erreur lors du demarrage', en: 'Failed to start', de: 'Start fehlgeschlagen', es: 'Error al iniciar', it: 'Errore di avvio',
  },
  'play.error.loadFailed': {
    fr: 'Impossible de charger la partie', en: 'Unable to load the game', de: 'Spiel konnte nicht geladen werden', es: 'No se pudo cargar la partida', it: 'Impossibile caricare la partita',
  },
  'play.error.fetchFailed': {
    fr: 'Erreur de chargement', en: 'Loading error', de: 'Ladefehler', es: 'Error de carga', it: 'Errore di caricamento',
  },
  'play.error.answerNotAvailable': {
    fr: 'Reponse non disponible', en: 'Answer not available', de: 'Antwort nicht verfugbar', es: 'Respuesta no disponible', it: 'Risposta non disponibile',
  },
  'ar.validateNow': {
    fr: 'Valider maintenant', en: 'Validate now', de: 'Jetzt bestatigen', es: 'Validar ahora', it: 'Convalida ora',
  },
  'ar.validateNowHelp': {
    fr: 'Tu es au bon endroit ? Tape ici si la validation auto ne se declenche pas.',
    en: "You're at the right spot? Tap here if the auto-validation doesn't fire.",
    de: 'Bist du am richtigen Ort? Tippe hier, falls die Auto-Bestatigung nicht ausgelost wird.',
    es: 'Estas en el lugar correcto? Toca aqui si la validacion automatica no se dispara.',
    it: "Sei nel posto giusto? Tocca qui se la convalida automatica non si avvia.",
  },
  'ar.hintButton': {
    fr: 'Indice', en: 'Hint', de: 'Hinweis', es: 'Pista', it: 'Indizio',
  },
  'ar.skipButton': {
    fr: 'Passer', en: 'Skip', de: 'Uberspringen', es: 'Saltar', it: 'Salta',
  },
  'play.routeAttractions': {
    fr: 'Sur le chemin, ne manque pas', en: "Don't miss along the way", de: 'Unterwegs nicht verpassen', es: 'No te pierdas en el camino', it: 'Da non perdere lungo il cammino',
  },
  'play.arAutoValidate': {
    fr: "Une fois en RA, l'etape se valide quand l'indice s'affiche.",
    en: "Once in AR, the step validates when the clue appears.",
    de: "In AR validiert sich die Etappe, sobald der Hinweis erscheint.",
    es: "Una vez en RA, la etapa se valida cuando aparece la pista.",
    it: "Una volta in AR, la tappa si convalida quando l'indizio appare.",
  },
  'play.arCloseButOutside': {
    fr: "Si vous voyez deja le monument, ouvrez la RA — l'etape se validera quand l'indice s'affichera.",
    en: "If you can already see the landmark, open AR — the step will validate when the clue appears.",
    de: "Wenn Sie das Denkmal bereits sehen, oeffnen Sie AR — die Etappe validiert sich, sobald der Hinweis erscheint.",
    es: "Si ya ves el monumento, abre RA — la etapa se validara cuando aparezca la pista.",
    it: "Se vedi gia il monumento, apri AR — la tappa si convalidera quando appare l'indizio.",
  },
  'play.arStillFar': {
    fr: "Continuez vers le monument.",
    en: "Keep walking toward the landmark.",
    de: "Gehen Sie weiter zum Denkmal.",
    es: "Continua hacia el monumento.",
    it: "Continua verso il monumento.",
  },
  'play.notTheTarget': {
    fr: 'Ce n\'est pas le bon endroit', en: 'Not the right place', de: 'Nicht der richtige Ort', es: 'No es el lugar correcto', it: 'Non e il posto giusto',
  },
  'play.youPhotographed': {
    fr: 'Vous avez photographie', en: 'You photographed', de: 'Sie haben fotografiert', es: 'Has fotografiado', it: 'Hai fotografato',
  },
  'play.aiDisclaimer': {
    fr: 'Reconnaissance IA, peut contenir des imprecisions', en: 'AI recognition, may contain inaccuracies', de: 'KI-Erkennung, kann Ungenauigkeiten enthalten', es: 'Reconocimiento IA, puede contener imprecisiones', it: 'Riconoscimento IA, puo contenere imprecisioni',
  },
  'play.validatePhoto': {
    fr: 'Valider par photo', en: 'Validate by photo', de: 'Per Foto bestatigen', es: 'Validar por foto', it: 'Valida con foto',
  },
  'play.hint': {
    fr: 'Indice', en: 'Hint', de: 'Hinweis', es: 'Pista', it: 'Indizio',
  },
  'play.reactivateGps': {
    fr: 'Reactiver le GPS', en: 'Reactivate GPS', de: 'GPS reaktivieren', es: 'Reactivar GPS', it: 'Riattiva GPS',
  },
  'play.tooFar': {
    fr: 'Vous etes a {distance} de l\'objectif', en: 'You are {distance} from the target', de: 'Sie sind {distance} vom Ziel entfernt', es: 'Estas a {distance} del objetivo', it: 'Sei a {distance} dall\'obiettivo',
  },
  'play.skip': {
    fr: 'Passer', en: 'Skip', de: 'Uberspringen', es: 'Saltar', it: 'Salta',
  },
  'play.menu': {
    fr: 'Menu', en: 'Menu', de: 'Menu', es: 'Menu', it: 'Menu',
  },
  'play.menuActions': {
    fr: 'Actions', en: 'Actions', de: 'Aktionen', es: 'Acciones', it: 'Azioni',
  },
  'play.notebookTitle': {
    fr: 'Mon carnet', en: 'My notebook', de: 'Mein Notizbuch', es: 'Mi cuaderno', it: 'Il mio taccuino',
  },
  'play.notebookDesc': {
    fr: 'Notez et relisez vos reponses', en: 'Write and review your answers', de: 'Antworten notieren und nachlesen', es: 'Anotar y revisar tus respuestas', it: 'Annota e rivedi le tue risposte',
  },
  'play.validateByPhoto': {
    fr: 'Valider par photo', en: 'Validate by photo', de: 'Mit Foto bestatigen', es: 'Validar por foto', it: 'Convalida con foto',
  },
  'play.validateByPhotoDesc': {
    fr: 'Si le GPS est imprecis, photographiez la cible', en: 'If GPS is inaccurate, photograph the target', de: 'Wenn GPS ungenau ist, fotografieren Sie das Ziel', es: 'Si el GPS es impreciso, fotografia el objetivo', it: 'Se il GPS e impreciso, fotografa l\'obiettivo',
  },
  'play.hintAction': {
    fr: 'Demander un indice', en: 'Request a hint', de: 'Hinweis anfordern', es: 'Pedir una pista', it: 'Richiedi un indizio',
  },
  'play.hintActionDesc': {
    fr: 'Un coup de pouce pour avancer', en: 'A nudge to keep going', de: 'Ein Anstoss, um weiterzukommen', es: 'Un empujoncito para avanzar', it: 'Una spinta per andare avanti',
  },
  'play.skipAction': {
    fr: "Passer l'etape", en: 'Skip the step', de: 'Schritt uberspringen', es: 'Saltar la etapa', it: 'Salta la tappa',
  },
  'play.skipActionDesc': {
    fr: 'La reponse sera revelee, on continue', en: 'The answer is revealed, we move on', de: 'Die Antwort wird enthullt, weiter geht es', es: 'Se revela la respuesta, seguimos', it: 'La risposta viene rivelata, si continua',
  },

  // Play page - Notebook
  'play.notebookHint': {
    fr: 'Notez vos reponses ici pour le code final', en: 'Note your answers here for the final code', de: 'Notieren Sie hier Ihre Antworten fur den Endcode', es: 'Anota tus respuestas aqui para el codigo final', it: 'Annota le tue risposte qui per il codice finale',
  },
  'play.finalCode': {
    fr: 'Code Final', en: 'Final Code', de: 'Endcode', es: 'Codigo Final', it: 'Codice Finale',
  },
  'play.assembleAnswers': {
    fr: 'Assemblez toutes vos reponses pour former le code secret !', en: 'Assemble all your answers to form the secret code!', de: 'Setzen Sie alle Ihre Antworten zusammen, um den Geheimcode zu bilden!', es: 'Junta todas tus respuestas para formar el codigo secreto!', it: 'Assembla tutte le tue risposte per formare il codice segreto!',
  },
  'play.assembleDashes': {
    fr: 'Assemblez vos reponses separees par des tirets :', en: 'Assemble your answers separated by dashes:', de: 'Setzen Sie Ihre Antworten mit Bindestrichen zusammen:', es: 'Junta tus respuestas separadas por guiones:', it: 'Assembla le tue risposte separate da trattini:',
  },
  'play.yourClues': {
    fr: 'Vos indices collectes', en: 'Your collected clues', de: 'Ihre gesammelten Hinweise', es: 'Tus pistas recogidas', it: 'I tuoi indizi raccolti',
  },
  'play.assembleHint': {
    fr: 'Combinez ces indices pour former la reponse finale (espaces et tirets ignores)', en: 'Combine these clues to form the final answer (spaces and dashes ignored)', de: 'Kombinieren Sie diese Hinweise zur endgultigen Antwort (Leerzeichen und Bindestriche werden ignoriert)', es: 'Combina estas pistas para formar la respuesta final (espacios y guiones ignorados)', it: 'Combina questi indizi per formare la risposta finale (spazi e trattini ignorati)',
  },
  'play.approachAlert': {
    fr: 'Attention, vous approchez du lieu. Ouvrez les yeux et levez la tete !',
    en: 'Heads up, you are approaching the spot. Open your eyes and look up!',
    de: 'Achtung, Sie nahern sich dem Ort. Augen auf und Kopf hoch!',
    es: 'Atencion, te estas acercando al lugar. Abre los ojos y mira arriba!',
    it: 'Attenzione, ti stai avvicinando al luogo. Apri gli occhi e guarda in alto!',
  },
  'play.seeResults': {
    fr: 'Voir mes resultats !', en: 'See my results!', de: 'Meine Ergebnisse sehen!', es: 'Ver mis resultados!', it: 'Vedi i miei risultati!',
  },

  'play.answerLocked': {
    fr: 'Attention : votre reponse sera verrouillee et ne pourra plus etre modifiee.', en: 'Warning: your answer will be locked and cannot be changed later.', de: 'Achtung: Ihre Antwort wird gesperrt und kann spater nicht mehr geandert werden.', es: 'Atencion: tu respuesta sera bloqueada y no podra modificarse despues.', it: 'Attenzione: la vostra risposta sara bloccata e non potra essere modificata.',
  },
  'play.mustNoteAnswer': {
    fr: 'Notez votre reponse ci-dessus avant de continuer', en: 'Write your answer above before continuing', de: 'Notieren Sie Ihre Antwort oben, bevor Sie fortfahren', es: 'Anota tu respuesta arriba antes de continuar', it: 'Annota la tua risposta sopra prima di continuare',
  },
  'play.upcoming': {
    fr: 'A venir', en: 'Upcoming', de: 'Kommt noch', es: 'Proximo', it: 'In arrivo',
  },

  // Play page - Dialogs
  'play.askHint': {
    fr: "Demander l'indice {n}/{total} ?", en: 'Request hint {n}/{total}?', de: 'Hinweis {n}/{total} anfordern?', es: 'Pedir pista {n}/{total}?', it: 'Richiedere indizio {n}/{total}?',
  },
  'play.skipConfirm': {
    fr: 'Passer cette etape ?\n\nVous serez penalise de 45 minutes sur votre temps final.\nLa reponse vous sera revelee.', en: 'Skip this step?\n\nYou will be penalized 45 minutes on your final time.\nThe answer will be revealed.', de: 'Diesen Schritt uberspringen?\n\nSie werden mit 45 Minuten auf Ihre Endzeit bestraft.\nDie Antwort wird enthullt.', es: 'Saltar esta etapa?\n\nSeras penalizado 45 minutos en tu tiempo final.\nLa respuesta sera revelada.', it: 'Saltare questa tappa?\n\nSarai penalizzato di 45 minuti sul tempo finale.\nLa risposta sara rivelata.',
  },

  // Navigation
  'nav.towards': {
    fr: 'vers le', en: 'towards', de: 'Richtung', es: 'hacia el', it: 'verso',
  },
  'nav.direction': {
    fr: 'direction', en: 'direction', de: 'Richtung', es: 'direccion', it: 'direzione',
  },
  'map.divanArrow': {
    fr: 'Fleche DIVAN',
    en: 'DIVAN arrow',
    de: 'DIVAN-Pfeil',
    es: 'Flecha DIVAN',
    it: 'Freccia DIVAN',
  },
  'play.divanIntroTitle': {
    fr: 'Nouveau : mode DIVAN sur la carte',
    en: 'New: DIVAN mode on the map',
    de: 'Neu: DIVAN-Modus auf der Karte',
    es: 'Nuevo: modo DIVAN en el mapa',
    it: 'Nuovo: modalita DIVAN sulla mappa',
  },
  'play.divanIntroDesc': {
    fr: 'Votre position est desormais entouree d\'une grande fleche verte qui pivote automatiquement vers le prochain objectif, et une ligne en pointilles relie les deux points avec la distance au milieu. Aucune boussole n\'est necessaire : tout est calcule a partir du GPS et s\'actualise en temps reel au fur et a mesure que vous avancez.',
    en: 'Your position is now wrapped in a large green arrow that automatically pivots toward the next objective, and a dashed line connects the two points with the distance in the middle. No compass needed: everything is computed from GPS and refreshes in real time as you move.',
    de: 'Ihre Position ist jetzt von einem grossen grunen Pfeil umgeben, der sich automatisch zum nachsten Ziel dreht, und eine gestrichelte Linie verbindet die beiden Punkte mit der Entfernung in der Mitte. Kein Kompass erforderlich: Alles wird aus dem GPS berechnet und aktualisiert sich in Echtzeit, wahrend Sie sich bewegen.',
    es: 'Tu posicion esta ahora rodeada de una gran flecha verde que pivota automaticamente hacia el proximo objetivo, y una linea de puntos conecta los dos puntos con la distancia en el centro. No se necesita brujula: todo se calcula a partir del GPS y se actualiza en tiempo real mientras te mueves.',
    it: 'La tua posizione e ora circondata da una grande freccia verde che ruota automaticamente verso il prossimo obiettivo, e una linea tratteggiata collega i due punti con la distanza al centro. Nessuna bussola necessaria: tutto e calcolato dal GPS e si aggiorna in tempo reale mentre ti muovi.',
  },
  'nav.walkMin': {
    fr: 'min a pied', en: 'min walk', de: 'Min. zu Fuss', es: 'min a pie', it: 'min a piedi',
  },
  'nav.locating': {
    fr: 'Localisation en cours...', en: 'Locating...', de: 'Ortung lauft...', es: 'Localizando...', it: 'Localizzazione...',
  },
  'nav.movePhone': {
    fr: 'Bougez votre telephone pour activer la boussole', en: 'Move your phone to activate the compass', de: 'Bewegen Sie Ihr Telefon, um den Kompass zu aktivieren', es: 'Mueve tu telefono para activar la brujula', it: 'Muovi il telefono per attivare la bussola',
  },
  'nav.enlarge': {
    fr: 'Agrandir', en: 'Enlarge', de: 'Vergrossern', es: 'Ampliar', it: 'Ingrandisci',
  },
  'nav.reduce': {
    fr: 'Reduire', en: 'Reduce', de: 'Verkleinern', es: 'Reducir', it: 'Riduci',
  },
  'nav.arrived': {
    fr: 'Vous etes deja arrive !', en: 'You have already arrived!', de: 'Sie sind bereits angekommen!', es: 'Ya has llegado!', it: 'Sei gia arrivato!',
  },

  // ── Report error widget (player-facing, used after a riddle) ─────────
  'reportError.trigger': {
    fr: 'Signaler une erreur', en: 'Report an error', de: 'Fehler melden', es: 'Reportar un error', it: 'Segnala un errore',
  },
  'reportError.title': {
    fr: 'Signaler une erreur', en: 'Report an error', de: 'Fehler melden', es: 'Reportar un error', it: 'Segnala un errore',
  },
  'reportError.subtitle': {
    fr: "Vous avez identifie une erreur dans cette enigme ? Merci de nous la signaler.",
    en: 'Found an error in this riddle? Thank you for reporting it.',
    de: 'Haben Sie einen Fehler in diesem Ratsel gefunden? Danke fur die Meldung.',
    es: '¿Has encontrado un error en este enigma? Gracias por reportarlo.',
    it: 'Hai trovato un errore in questo enigma? Grazie per la segnalazione.',
  },
  'reportError.placeholder': {
    fr: "Decrivez l'erreur (reponse incorrecte, indice trompeur, lieu introuvable...)",
    en: 'Describe the error (wrong answer, misleading hint, location not found...)',
    de: 'Beschreiben Sie den Fehler (falsche Antwort, irrefuhrender Hinweis...)',
    es: 'Describe el error (respuesta incorrecta, pista enganosa, lugar no encontrado...)',
    it: "Descrivi l'errore (risposta sbagliata, indizio fuorviante, luogo non trovato...)",
  },
  'reportError.send': {
    fr: 'Envoyer', en: 'Send', de: 'Senden', es: 'Enviar', it: 'Invia',
  },
  'reportError.cancel': {
    fr: 'Annuler', en: 'Cancel', de: 'Abbrechen', es: 'Cancelar', it: 'Annulla',
  },
  'reportError.success': {
    fr: 'Merci ! Votre signalement a ete envoye.',
    en: 'Thank you! Your report has been sent.',
    de: 'Danke! Ihre Meldung wurde gesendet.',
    es: '¡Gracias! Tu reporte ha sido enviado.',
    it: 'Grazie! La tua segnalazione e stata inviata.',
  },
  'reportError.error': {
    fr: "Erreur lors de l'envoi. Reessayez.",
    en: 'Error sending report. Please try again.',
    de: 'Fehler beim Senden. Bitte versuchen Sie es erneut.',
    es: 'Error al enviar. Intentalo de nuevo.',
    it: "Errore nell'invio. Riprova.",
  },

  // ── Truth reveal panel (results page when player gave up / failed) ──
  'truth.heading': {
    fr: 'La Verite Revelee', en: 'The Truth Revealed', de: 'Die Enthullte Wahrheit', es: 'La Verdad Revelada', it: 'La Verita Rivelata',
  },
  'truth.intro': {
    fr: "Tu n'as pas trouve le code final, mais chaque enigme a sa cle. Voici ce que les pierres murmuraient pour chacun des lieux que tu as visites.",
    en: "You didn't crack the final code, but every riddle has its key. Here is what the stones whispered at each place you visited.",
    de: 'Du hast den finalen Code nicht geknackt, aber jedes Ratsel hat seinen Schlussel. Dies ist, was die Steine an jedem besuchten Ort flusterten.',
    es: 'No descifraste el codigo final, pero cada enigma tiene su clave. Esto es lo que las piedras susurraban en cada lugar que visitaste.',
    it: 'Non hai decifrato il codice finale, ma ogni enigma ha la sua chiave. Ecco cosa sussurravano le pietre in ogni luogo che hai visitato.',
  },
  'truth.stepLabel': {
    fr: 'Etape', en: 'Step', de: 'Etappe', es: 'Etapa', it: 'Tappa',
  },
  'truth.was': {
    fr: 'etait', en: 'was', de: 'war', es: 'era', it: 'era',
  },

  // ── Epilogue ─────────────────────────────────────────────────────────
  'epilogue.label': {
    fr: "L'Epilogue", en: 'The Epilogue', de: 'Der Epilog', es: 'El Epilogo', it: "L'Epilogo",
  },
  'epilogue.codeUnlocked': {
    fr: 'Code final trouve', en: 'Final code unlocked', de: 'Code geknackt', es: 'Codigo final descifrado', it: 'Codice finale svelato',
  },
  'epilogue.listen': {
    fr: 'Ecouter le recit complet', en: 'Listen to the full story', de: 'Die ganze Geschichte horen', es: 'Escuchar la historia completa', it: "Ascolta l'intero racconto",
  },
  'epilogue.pause': {
    fr: 'Pause', en: 'Pause', de: 'Pause', es: 'Pausa', it: 'Pausa',
  },

  // ── Results page ─────────────────────────────────────────────────────
  'results.unavailable': {
    fr: 'Resultats indisponibles', en: 'Results unavailable', de: 'Ergebnisse nicht verfugbar', es: 'Resultados no disponibles', it: 'Risultati non disponibili',
  },
  'results.backHome': {
    fr: "Retour a l'accueil", en: 'Back to home', de: 'Zuruck zur Startseite', es: 'Volver al inicio', it: 'Torna alla home',
  },
  'results.congrats': {
    fr: 'Felicitations !', en: 'Congratulations!', de: 'Gluckwunsch!', es: '¡Felicidades!', it: 'Complimenti!',
  },
  // ── Avis de fin de partie (étoiles + texte) ──
  'results.reviewTitle': {
    fr: 'Note ton expérience', en: 'Rate your experience', de: 'Bewerte dein Erlebnis', es: 'Valora tu experiencia', it: 'Valuta la tua esperienza',
  },
  'results.reviewSubtitle': {
    fr: 'Ton avis nous aide énormément 🙏', en: 'Your feedback helps us a lot 🙏', de: 'Dein Feedback hilft uns sehr 🙏', es: 'Tu opinión nos ayuda muchísimo 🙏', it: 'Il tuo parere ci aiuta molto 🙏',
  },
  'results.reviewPickStars': {
    fr: 'Choisis une note', en: 'Pick a rating', de: 'Wähle eine Bewertung', es: 'Elige una valoración', it: 'Scegli un voto',
  },
  'results.reviewPlaceholder': {
    fr: 'Raconte ton expérience (facultatif)…', en: 'Tell us about your experience (optional)…', de: 'Erzähl uns von deinem Erlebnis (optional)…', es: 'Cuéntanos tu experiencia (opcional)…', it: 'Raccontaci la tua esperienza (facoltativo)…',
  },
  'results.reviewSubmit': {
    fr: 'Envoyer mon avis', en: 'Submit my review', de: 'Bewertung senden', es: 'Enviar mi opinión', it: 'Invia la recensione',
  },
  'results.reviewThanks': {
    fr: 'Merci pour ton avis ! 🙏', en: 'Thanks for your feedback! 🙏', de: 'Danke für dein Feedback! 🙏', es: '¡Gracias por tu opinión! 🙏', it: 'Grazie per il tuo parere! 🙏',
  },
  'results.reviewThanksPublic': {
    fr: 'Merci ! Ton avis pourra apparaître sur la page du jeu.', en: 'Thank you! Your review may appear on the game page.', de: 'Danke! Deine Bewertung kann auf der Spielseite erscheinen.', es: '¡Gracias! Tu opinión podría aparecer en la página del juego.', it: 'Grazie! La tua recensione potrà apparire sulla pagina del gioco.',
  },
  'results.reviewSeePublic': {
    fr: 'Voir les avis', en: 'See reviews', de: 'Bewertungen ansehen', es: 'Ver opiniones', it: 'Vedi le recensioni',
  },
  'results.reviewError': {
    fr: "Envoi impossible. Réessaie.", en: "Couldn't send. Try again.", de: 'Senden fehlgeschlagen. Versuch es nochmal.', es: 'No se pudo enviar. Inténtalo de nuevo.', it: 'Invio non riuscito. Riprova.',
  },
  // ── Page publique d'avis /avis/[slug] ──
  'reviews.pageTitle': {
    fr: 'Avis des joueurs', en: 'Player reviews', de: 'Bewertungen der Spieler', es: 'Opiniones de jugadores', it: 'Recensioni dei giocatori',
  },
  'reviews.count': {
    fr: 'témoignages', en: 'reviews', de: 'Bewertungen', es: 'opiniones', it: 'recensioni',
  },
  'reviews.empty': {
    fr: "Sois le premier à partager ton avis sur cette aventure !", en: 'Be the first to share your review of this adventure!', de: 'Sei der Erste, der diese Tour bewertet!', es: '¡Sé el primero en opinar sobre esta aventura!', it: 'Sii il primo a recensire questa avventura!',
  },
  'reviews.anonymous': {
    fr: 'Joueur', en: 'Player', de: 'Spieler', es: 'Jugador', it: 'Giocatore',
  },
  'reviews.footer': {
    fr: 'Avis vérifiés de joueurs ayant terminé le jeu', en: 'Verified reviews from players who completed the game', de: 'Verifizierte Bewertungen von Spielern, die das Spiel beendet haben', es: 'Opiniones verificadas de jugadores que completaron el juego', it: 'Recensioni verificate di giocatori che hanno completato il gioco',
  },
  'results.scoreFinal': {
    fr: 'Score final', en: 'Final score', de: 'Endpunktzahl', es: 'Puntuacion final', it: 'Punteggio finale',
  },
  'results.points': {
    fr: 'points', en: 'points', de: 'Punkte', es: 'puntos', it: 'punti',
  },
  'results.timeTotal': {
    fr: 'Temps total', en: 'Total time', de: 'Gesamtzeit', es: 'Tiempo total', it: 'Tempo totale',
  },
  'results.hints': {
    fr: 'Indices', en: 'Hints', de: 'Hinweise', es: 'Pistas', it: 'Indizi',
  },
  'results.rank': {
    fr: 'Classement', en: 'Rank', de: 'Rang', es: 'Clasificacion', it: 'Classifica',
  },
  'results.hintsPenalty': {
    fr: 'Penalite indices', en: 'Hint penalty', de: 'Hinweis-Strafe', es: 'Penalizacion pistas', it: 'Penalita indizi',
  },
  'results.stepByStep': {
    fr: 'Correction etape par etape', en: 'Step-by-step review', de: 'Schritt-fur-Schritt-Auswertung', es: 'Repaso paso a paso', it: 'Revisione passo dopo passo',
  },
  'results.answer': {
    fr: 'Reponse', en: 'Answer', de: 'Antwort', es: 'Respuesta', it: 'Risposta',
  },
  'results.didYouKnow': {
    fr: 'Le saviez-vous ?', en: 'Did you know?', de: 'Wussten Sie schon?', es: '¿Sabias que?', it: 'Lo sapevi?',
  },
  'results.hintCount': {
    fr: 'indice(s)', en: 'hint(s)', de: 'Hinweis(e)', es: 'pista(s)', it: 'indizio/i',
  },
  'results.penalty': {
    fr: 'penalite', en: 'penalty', de: 'Strafe', es: 'penalizacion', it: 'penalita',
  },
  'results.selfie': {
    fr: 'Photo souvenir', en: 'Souvenir photo', de: 'Erinnerungsfoto', es: 'Foto de recuerdo', it: 'Foto ricordo',
  },
  'results.share': {
    fr: 'Partager', en: 'Share', de: 'Teilen', es: 'Compartir', it: 'Condividi',
  },
  'results.shareText': {
    fr: 'J\'ai termine "{title}" avec un score de {score} points ! ({time})',
    en: 'I finished "{title}" with a score of {score} points! ({time})',
    de: 'Ich habe "{title}" mit {score} Punkten beendet! ({time})',
    es: 'He terminado "{title}" con {score} puntos! ({time})',
    it: 'Ho finito "{title}" con {score} punti! ({time})',
  },
  'results.shareTitle': {
    fr: 'Escape Game Outdoor', en: 'Outdoor Escape Game', de: 'Outdoor Escape Game', es: 'Outdoor Escape Game', it: 'Escape Game Outdoor',
  },
  'results.defaultPlayerName': {
    fr: 'Joueur', en: 'Player', de: 'Spieler', es: 'Jugador', it: 'Giocatore',
  },
  'results.loadError': {
    fr: 'Impossible de charger les resultats',
    en: 'Unable to load results',
    de: 'Ergebnisse konnten nicht geladen werden',
    es: 'No se pueden cargar los resultados',
    it: 'Impossibile caricare i risultati',
  },

  // ── Leaderboard ──────────────────────────────────────────────────────
  'leaderboard.title': {
    fr: 'Classement', en: 'Leaderboard', de: 'Rangliste', es: 'Clasificacion', it: 'Classifica',
  },
  'leaderboard.empty': {
    fr: 'Aucun resultat pour le moment.', en: 'No results yet.', de: 'Noch keine Ergebnisse.', es: 'Aun no hay resultados.', it: 'Nessun risultato ancora.',
  },
  'leaderboard.beFirst': {
    fr: 'Soyez le premier a terminer !', en: 'Be the first to finish!', de: 'Seien Sie der Erste, der fertig wird!', es: '¡Se el primero en terminar!', it: 'Sii il primo a finire!',
  },

  // ── Map controls ─────────────────────────────────────────────────────
  'map.recenter': {
    fr: 'Recentrer la carte', en: 'Recenter map', de: 'Karte zentrieren', es: 'Centrar mapa', it: 'Centra mappa',
  },

  // ── Play page extras (verify, exit confirm, reveal story) ────────────
  'play.verify': {
    fr: 'Verifier', en: 'Verify', de: 'Prufen', es: 'Verificar', it: 'Verifica',
  },
  'play.verifyError': {
    fr: 'Erreur de verification', en: 'Verification error', de: 'Uberprufungsfehler', es: 'Error de verificacion', it: 'Errore di verifica',
  },
  'play.revealStory': {
    fr: "Decouvrir l'histoire et la verite",
    en: 'Reveal the story and the truth',
    de: 'Die Geschichte und Wahrheit enthullen',
    es: 'Revelar la historia y la verdad',
    it: 'Rivelare la storia e la verita',
  },
  'play.exitConfirm': {
    fr: 'Quitter la partie ? Tes indices et ta progression sont sauvegardes, mais le chrono continue.',
    en: 'Leave the game? Your hints and progress are saved, but the timer keeps running.',
    de: 'Spiel verlassen? Hinweise und Fortschritt werden gespeichert, aber der Timer lauft weiter.',
    es: '¿Salir del juego? Tus pistas y progreso se guardan, pero el cronometro sigue.',
    it: 'Uscire dalla partita? I tuoi indizi e progressi sono salvati, ma il timer continua.',
  },

  // ── AR badge on the riddle view (shown above the riddle text on
  //    every virtual_ar step, so the player knows from the start that
  //    the answer is hidden in the AR camera and not in the surrounding
  //    real-world stones).
  'play.arRequiredBadge': {
    fr: 'Realite augmentee',
    en: 'Augmented reality',
    de: 'Augmented Reality',
    es: 'Realidad aumentada',
    it: 'Realta aumentata',
  },
  'play.arRequiredHint': {
    fr: "Sur place, ouvre la camera de ton telephone : la reponse apparaitra en surimpression sur la facade ou autour de toi.",
    en: 'Once on site, open your phone camera: the answer will appear overlaid on the facade or around you.',
    de: 'Sobald du vor Ort bist, offne die Handy-Kamera: die Antwort erscheint als Uberlagerung auf der Fassade oder um dich herum.',
    es: 'Una vez en el lugar, abre la camara del movil: la respuesta aparecera superpuesta sobre la fachada o a tu alrededor.',
    it: "Una volta sul posto, apri la fotocamera del telefono: la risposta apparira in sovrimpressione sulla facciata o intorno a te.",
  },

  // ── Generic confirm dialog buttons (used by ConfirmDialog) ───────────
  'confirm.ok': {
    fr: 'OK', en: 'OK', de: 'OK', es: 'OK', it: 'OK',
  },
  'confirm.cancel': {
    fr: 'Annuler', en: 'Cancel', de: 'Abbrechen', es: 'Cancelar', it: 'Annulla',
  },

  // ── AR character speaker (names + a11y) ──────────────────────────────
  'character.knight': { fr: 'Le Chevalier', en: 'The Knight', de: 'Der Ritter', es: 'El Caballero', it: 'Il Cavaliere' },
  'character.witch': { fr: 'La Sorciere', en: 'The Witch', de: 'Die Hexe', es: 'La Bruja', it: 'La Strega' },
  'character.monk': { fr: 'Le Moine', en: 'The Monk', de: 'Der Monch', es: 'El Monje', it: 'Il Monaco' },
  'character.sailor': { fr: 'Le Marin', en: 'The Sailor', de: 'Der Seemann', es: 'El Marinero', it: 'Il Marinaio' },
  'character.detective': { fr: 'Le Detective', en: 'The Detective', de: 'Der Detektiv', es: 'El Detective', it: 'Il Detective' },
  'character.ghost': { fr: 'Le Fantome', en: 'The Ghost', de: 'Das Gespenst', es: 'El Fantasma', it: 'Il Fantasma' },
  'character.princess': { fr: 'La Princesse', en: 'The Princess', de: 'Die Prinzessin', es: 'La Princesa', it: 'La Principessa' },
  'character.peasant': { fr: 'Le Villageois', en: 'The Villager', de: 'Der Dorfbewohner', es: 'El Aldeano', it: 'Il Paesano' },
  'character.soldier': { fr: 'Le Soldat', en: 'The Soldier', de: 'Der Soldat', es: 'El Soldado', it: 'Il Soldato' },
  'character.guideMale': { fr: 'Le Guide', en: 'The Guide', de: 'Der Fuhrer', es: 'El Guia', it: 'La Guida' },
  'character.guideFemale': { fr: 'La Guide', en: 'The Guide', de: 'Die Fuhrerin', es: 'La Guia', it: 'La Guida' },
  'ar.dismissCharacter': {
    fr: 'Fermer', en: 'Dismiss', de: 'Schliessen', es: 'Cerrar', it: 'Chiudi',
  },
  'ar.playNarration': {
    fr: 'Lire la narration', en: 'Play narration', de: 'Erzahlung abspielen', es: 'Reproducir narracion', it: 'Riproduci narrazione',
  },
  'ar.stopNarration': {
    fr: 'Arreter la narration', en: 'Stop narration', de: 'Erzahlung stoppen', es: 'Detener narracion', it: 'Ferma narrazione',
  },
};

// ----------------------------------------------------------------------
// Dynamic UI pack store (client + SSR-safe).
//
// Static locales (fr/en/de/es/it) are bundled in `ui` above. Dynamic
// locales (the 27 others — zh/ja/ko/th/vi/hi/id/ms/...) are loaded at
// runtime from /api/ui-translations and merged into this module-level
// store. The `tt()` function below checks this store first before falling
// back to the static `ui` map (English).
//
// Components subscribe via `useDynamicTranslationsVersion()` so they
// re-render when a new pack lands — without that, the first render
// after locale switch would be stuck on English fallback forever.
// ----------------------------------------------------------------------

const dynamicPacks: Record<string, Record<string, string>> = {};
let dynamicVersion = 0;
const subscribers = new Set<() => void>();

/**
 * Replace the cached pack for `locale` with `pack` (whole-pack replacement,
 * not key-by-key merge — the API always returns the full set). Bumps the
 * version and notifies subscribers so React components re-render.
 */
export function setDynamicUIPack(locale: string, pack: Record<string, string>): void {
  dynamicPacks[locale.toLowerCase()] = pack;
  dynamicVersion++;
  subscribers.forEach((cb) => cb());
}

export function clearDynamicUIPack(locale: string): void {
  delete dynamicPacks[locale.toLowerCase()];
  dynamicVersion++;
  subscribers.forEach((cb) => cb());
}

export function subscribeDynamicUI(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getDynamicUIVersion(): number {
  return dynamicVersion;
}

/**
 * Get UI string for a given key and locale.
 *
 * Resolution order:
 *   1. Dynamic pack for this locale (if loaded — covers 27 dynamic langs)
 *   2. Static `ui` map for this locale (covers fr/en/de/es/it)
 *   3. English in static `ui`
 *   4. French in static `ui`
 *   5. The key itself (last-resort visible signal)
 */
export function tt(key: string, locale: string): string {
  const dyn = dynamicPacks[locale.toLowerCase()]?.[key];
  if (dyn) return dyn;

  const entry = ui[key];
  if (!entry) return key;
  return entry[locale as StaticLocale] || entry.en || entry.fr || key;
}
