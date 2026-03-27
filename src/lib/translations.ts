import { Locale } from './i18n';

type Translations = Record<string, Record<Locale, string>>;

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
};

export function tt(key: string, locale: Locale): string {
  const entry = ui[key];
  if (!entry) return key;
  return entry[locale] || entry.fr || key;
}
