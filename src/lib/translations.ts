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
    fr: 'Avant de partir', en: 'Before you head out', de: 'Bevor Sie loslegen', es: 'Antes de salir', it: 'Prima di partire',
  },
  'tutorial.s1.text': {
    fr: "Duree estimee : {duration}, entierement a pied en exterieur. Prevoyez de l'eau, des chaussures confortables et un telephone bien charge — la camera et le GPS vont tourner pendant tout le parcours. Vous avez 24 heures a partir de l'activation pour terminer votre aventure (pause dejeuner, retour le lendemain matin, tout est OK).",
    en: 'Estimated duration: {duration}, entirely on foot outdoors. Bring water, comfortable shoes and a well-charged phone — camera and GPS run the whole way. You have 24 hours from activation to finish your adventure (lunch break, come back the next morning, all fine).',
    de: 'Geschatzte Dauer: {duration}, komplett zu Fuss im Freien. Bringen Sie Wasser, bequeme Schuhe und ein gut geladenes Telefon mit — Kamera und GPS laufen die ganze Zeit. Sie haben 24 Stunden ab Aktivierung Zeit, um Ihr Abenteuer zu beenden (Mittagspause, am nachsten Morgen weitermachen, alles OK).',
    es: 'Duracion estimada: {duration}, totalmente a pie al aire libre. Lleva agua, calzado comodo y un movil bien cargado — la camara y el GPS funcionan todo el rato. Tienes 24 horas desde la activacion para terminar tu aventura (pausa para comer, volver al dia siguiente, todo vale).',
    it: "Durata stimata: {duration}, interamente a piedi all'aperto. Portate acqua, scarpe comode e uno smartphone ben carico — fotocamera e GPS lavorano per tutto il percorso. Avete 24 ore dall'attivazione per terminare l'avventura (pausa pranzo, ripresa il mattino dopo, tutto OK).",
  },
  'tutorial.s2.title': {
    fr: "Realite Augmentee : la regle d'or", en: 'Augmented Reality: the golden rule', de: 'Augmented Reality: die goldene Regel', es: 'Realidad Aumentada: la regla de oro', it: "Realta Aumentata: la regola d'oro",
  },
  'tutorial.s2.text': {
    fr: "A chaque etape, ce jeu se joue UNIQUEMENT en realite augmentee. Une enigme vous raconte une histoire, vous guide jusqu'a un lieu, et vous demande d'ouvrir votre camera AR pour decouvrir ce que les murs cachent. Pas d'inscription a chercher dans le monde reel — la magie apparait sur votre ecran.",
    en: 'At every step, this game is played EXCLUSIVELY in augmented reality. A riddle tells you a story, guides you to a location, and asks you to open your AR camera to discover what the walls are hiding. No real-world inscription to find — the magic appears on your screen.',
    de: 'Bei jedem Schritt wird dieses Spiel AUSSCHLIESSLICH in Augmented Reality gespielt. Ein Ratsel erzahlt eine Geschichte, fuhrt Sie zu einem Ort und bittet Sie, Ihre AR-Kamera zu offnen. Keine Inschrift in der realen Welt zu finden — die Magie erscheint auf Ihrem Bildschirm.',
    es: 'En cada etapa, este juego se juega UNICAMENTE en realidad aumentada. Un enigma te cuenta una historia, te guia hasta un lugar y te pide abrir tu camara AR para descubrir lo que ocultan los muros. No hay inscripciones que buscar — la magia aparece en tu pantalla.',
    it: "Ad ogni tappa, questo gioco si gioca SOLO in realta aumentata. Un enigma vi racconta una storia, vi guida verso un luogo, e vi chiede di aprire la fotocamera AR per scoprire cosa nascondono i muri. Niente iscrizioni da cercare nel mondo reale — la magia appare sul vostro schermo.",
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
    fr: 'Le grand bouton violet', en: 'The big purple button', de: 'Der grosse lila Knopf', es: 'El gran boton morado', it: 'Il grande pulsante viola',
  },
  'tutorial.s5.text': {
    fr: "Une fois sur place, regardez en bas de votre ecran : le grand bouton violet \"{arButton}\" est votre seul outil. Tapez-le. La camera s'ouvre, vous etes dans le mode jeu. C'est ICI que les indices se reveleront — jamais dans le monde reel.",
    en: "Once on site, look at the bottom of your screen: the big purple button \"{arButton}\" is your only tool. Tap it. The camera opens, you're in game mode. This is WHERE the clues reveal themselves — never in the real world.",
    de: "Wenn Sie vor Ort sind, schauen Sie auf den unteren Bildschirmrand: Der grosse lila Knopf \"{arButton}\" ist Ihr einziges Werkzeug. Tippen Sie darauf. Die Kamera offnet sich, Sie sind im Spielmodus. HIER offenbaren sich die Hinweise — nie in der realen Welt.",
    es: "Una vez en el lugar, mira la parte inferior de tu pantalla: el gran boton morado \"{arButton}\" es tu unica herramienta. Pulsalo. La camara se abre, estas en modo juego. AQUI se revelan las pistas — nunca en el mundo real.",
    it: "Una volta sul posto, guardate il fondo dello schermo: il grande pulsante viola \"{arButton}\" e il vostro unico strumento. Toccatelo. La fotocamera si apre, siete in modalita gioco. E QUI che gli indizi si rivelano — mai nel mondo reale.",
  },
  'tutorial.s6.title': {
    fr: "Cherchez l'indice partout", en: 'Hunt the clue everywhere', de: 'Suchen Sie den Hinweis uberall', es: 'Busca la pista por todas partes', it: "Cercate l'indizio ovunque",
  },
  'tutorial.s6.text': {
    fr: "Une fois la camera ouverte, balayez LENTEMENT tout ce qui vous entoure — les murs, le sol pave, les portes, les fenetres, les balcons, le ciel, les recoins sombres. Quelque part autour de vous, des lettres dorees vont se materialiser sur une surface : c'est votre reponse. Ne restez pas immobile, bougez le telephone dans toutes les directions.",
    en: "Once the camera is open, slowly sweep EVERYTHING around you — walls, cobblestones, doors, windows, balconies, the sky, dark corners. Somewhere around you, golden letters will materialise on a surface: that's your answer. Don't stand still — move the phone in all directions.",
    de: 'Wenn die Kamera offen ist, schwenken Sie LANGSAM uber ALLES um sich herum — Wande, Kopfsteinpflaster, Turen, Fenster, Balkone, den Himmel, dunkle Ecken. Irgendwo werden goldene Buchstaben auf einer Flache erscheinen: das ist Ihre Antwort. Bleiben Sie nicht stehen — bewegen Sie das Telefon in alle Richtungen.',
    es: 'Una vez la camara abierta, barre LENTAMENTE TODO a tu alrededor — muros, adoquines, puertas, ventanas, balcones, el cielo, rincones oscuros. En algun lugar, letras doradas apareceran en una superficie: esa es tu respuesta. No te quedes inmovil, mueve el movil en todas direcciones.',
    it: "Una volta aperta la fotocamera, scorrete LENTAMENTE TUTTO intorno a voi — muri, pavimentazione, porte, finestre, balconi, il cielo, angoli bui. Da qualche parte, lettere dorate si materializzeranno su una superficie: quella e la vostra risposta. Non state fermi, muovete il telefono in tutte le direzioni.",
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
    fr: 'Coince ? Demandez un indice', en: 'Stuck? Ask for a hint', de: 'Festgefahren? Fordern Sie einen Hinweis an', es: 'Atascado? Pide una pista', it: 'Bloccati? Chiedete un indizio',
  },
  'tutorial.s9.text': {
    fr: "Vous tournez en rond, l'indice ne se montre pas ? Demandez UN indice (icone ampoule). Il vous donnera la SURFACE precise a scanner et la FORME de la reponse (par exemple : \"scanne la facade au-dessus de la porte principale, c'est une date a 4 chiffres\"). Cout : un peu de temps sur votre score. Vraiment bloque ? Vous pouvez aussi passer l'etape (penalite plus lourde, mais la reponse vous est revelee).",
    en: "Going in circles, the clue won't show? Ask for ONE hint (bulb icon). It will tell you the exact SURFACE to scan and the SHAPE of the answer (e.g. \"scan the facade above the main door, it's a 4-digit year\"). Cost: a small time penalty on your score. Really stuck? You can also skip the step (heavier penalty, but the answer is revealed).",
    de: "Drehen sich im Kreis, der Hinweis erscheint nicht? Fordern Sie EINEN Hinweis an (Gluhbirnen-Symbol). Er nennt Ihnen die genaue FLACHE zum Scannen und die FORM der Antwort (z.B. \"scannen Sie die Fassade uber der Haupttur, es ist eine 4-stellige Jahreszahl\"). Kosten: eine kleine Zeitstrafe. Festgefahren? Sie konnen auch die Etappe uberspringen (schwerere Strafe, aber die Antwort wird enthullt).",
    es: "Das vueltas, la pista no aparece? Pide UNA pista (icono bombilla). Te dira la SUPERFICIE exacta a escanear y la FORMA de la respuesta (ej: \"escanea la fachada sobre la puerta principal, es un ano de 4 cifras\"). Coste: una pequena penalizacion de tiempo. Muy atascado? Tambien puedes saltar la etapa (penalizacion mas fuerte, pero la respuesta se revela).",
    it: "Girate a vuoto, l'indizio non appare? Chiedete UN indizio (icona lampadina). Vi dira la SUPERFICIE esatta da scansionare e la FORMA della risposta (es: \"scansiona la facciata sopra la porta principale, e un anno a 4 cifre\"). Costo: una piccola penalita di tempo. Davvero bloccati? Potete anche saltare la tappa (penalita piu pesante, ma la risposta viene rivelata).",
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
    fr: 'Point de depart', en: 'Starting point', de: 'Startpunkt', es: 'Punto de partida', it: 'Punto di partenza',
  },
  'play.startingPointDesc': {
    fr: 'Rendez-vous a ce point pour commencer l\'aventure. La premiere enigme vous y attend !',
    en: 'Meet at this point to start the adventure. The first riddle awaits you!',
    de: 'Treffpunkt, um das Abenteuer zu beginnen. Das erste Ratsel erwartet Sie!',
    es: 'Encuentrate en este punto para comenzar la aventura. El primer enigma te espera!',
    it: 'Raggiungi questo punto per iniziare l\'avventura. Il primo enigma ti aspetta!',
  },
  'play.startingPointDirection': {
    fr: 'Direction du point de depart', en: 'Direction to starting point', de: 'Richtung zum Startpunkt', es: 'Direccion al punto de partida', it: 'Direzione al punto di partenza',
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
    fr: 'Etape passee (+45 min de penalite)', en: 'Step skipped (+45 min penalty)', de: 'Schritt ubersprungen (+45 Min. Strafe)', es: 'Etapa saltada (+45 min de penalizacion)', it: 'Tappa saltata (+45 min di penalita)',
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
    fr: 'Penalite : +2 min (puis +10 min des le 4e)', en: 'Penalty: +2 min (then +10 min from the 4th)', de: 'Strafe: +2 Min. (ab dem 4. +10 Min.)', es: 'Penalizacion: +2 min (luego +10 min desde el 4º)', it: 'Penalita: +2 min (poi +10 min dal 4o)',
  },
  'play.skipAction': {
    fr: 'Passer l\'etape', en: 'Skip the step', de: 'Schritt uberspringen', es: 'Saltar la etapa', it: 'Salta la tappa',
  },
  'play.skipActionDesc': {
    fr: 'Penalite : +45 min · la reponse sera revelee', en: 'Penalty: +45 min · the answer will be revealed', de: 'Strafe: +45 Min. · die Antwort wird enthullt', es: 'Penalizacion: +45 min · se revelara la respuesta', it: 'Penalita: +45 min · la risposta sara rivelata',
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
    fr: 'Demander l\'indice {n}/{total} ?\n\nPenalite : +{penalty}', en: 'Request hint {n}/{total}?\n\nPenalty: +{penalty}', de: 'Hinweis {n}/{total} anfordern?\n\nStrafe: +{penalty}', es: 'Pedir pista {n}/{total}?\n\nPenalizacion: +{penalty}', it: 'Richiedere indizio {n}/{total}?\n\nPenalita: +{penalty}',
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
