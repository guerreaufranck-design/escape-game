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
  'play.reactivateGps': {
    fr: 'Reactiver le GPS', en: 'Reactivate GPS', de: 'GPS reaktivieren', es: 'Reactivar GPS', it: 'Riattiva GPS',
  },
  'play.tooFar': {
    fr: 'Vous etes a {distance} de l\'objectif', en: 'You are {distance} from the target', de: 'Sie sind {distance} vom Ziel entfernt', es: 'Estas a {distance} del objetivo', it: 'Sei a {distance} dall\'obiettivo',
  },
  'play.skip': {
    fr: 'Passer', en: 'Skip', de: 'Uberspringen', es: 'Saltar', it: 'Salta',
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

/**
 * Get UI string for a given key and locale.
 * For static locales, returns directly. For dynamic locales, returns English fallback.
 * Client should use /api/translations for dynamic locale strings.
 */
export function tt(key: string, locale: string): string {
  const entry = ui[key];
  if (!entry) return key;
  return entry[locale as StaticLocale] || entry.en || entry.fr || key;
}
