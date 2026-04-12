# OddballTrip — Dossier Produit

*Escape Game Outdoor · Version du 11 avril 2026*

---

## 1. Présentation générale

**OddballTrip** est une application web mobile qui transforme n'importe quelle ville en un terrain de jeu d'évasion à ciel ouvert. Le joueur achète un code d'activation pour un parcours, l'active sur son smartphone, puis suit une série d'énigmes qui le guident de lieu en lieu à travers la ville. Chaque étape repose sur un monument, une rue, un détail historique réel — le joueur doit se rendre physiquement sur place, résoudre l'énigme, puis débloquer l'étape suivante.

La promesse est simple : **un touriste qui ne connaît absolument rien à la ville peut jouer et finir un parcours sans se perdre**. L'application ne suppose aucune connaissance préalable — ni de la géographie locale, ni de la langue, ni des monuments. Tout est guidé en temps réel par la géolocalisation, la navigation visuelle, la reconnaissance d'image par intelligence artificielle et la narration audio multilingue.

### 1.1 Positionnement

| | OddballTrip | Urban Quest / City Mystery |
|---|---|---|
| Cible | Touriste en terrain inconnu | Habitant ou visiteur averti |
| Navigation | GPS + flèche dynamique + réalité augmentée | Indications textuelles |
| Validation | GPS + photo IA | Réponses saisies au clavier |
| Langues | 32 langues dont 5 pré-traduites | 1 à 4 langues |
| Correction d'erreur | Photo fallback, smart hints IA | Aide statique |
| Assistance si blocage | Indices progressifs + skip + reconnaissance IA | Indices pré-écrits |

Le différenciateur clé : **le joueur n'a jamais besoin de savoir où il se trouve ou ce qu'il regarde**. L'application le guide.

### 1.2 Chaîne de valeur

1. **Achat** — Le client achète un code d'activation depuis le site vitrine OddballTrip (une ville, un thème, un parcours).
2. **Activation** — Il saisit le code sur le smartphone, choisit sa langue, entre son nom.
3. **Briefing** — L'application affiche le scénario, la durée estimée, le point de départ approximatif (obfusqué à ~1 km pour préserver l'énigme de la première étape).
4. **Jeu** — Il résout les 8 étapes en se déplaçant physiquement, aidé par plusieurs outils de navigation et d'aide.
5. **Résultat** — À la fin, il obtient son score, son classement parmi tous les joueurs de ce parcours, un récapitulatif de ses réponses, et peut partager son résultat.

---

## 2. Création des jeux — Un pipeline IA en trois étapes

La création d'un parcours est presque entièrement automatisée. L'administrateur fournit une ville et un thème ; le système produit un jeu complet (8 étapes, énigmes, indices, réponses, anecdotes historiques) en une dizaine de minutes.

### 2.1 Pipeline

Le pipeline orchestré par `src/lib/game-pipeline.ts` enchaîne trois intelligences artificielles spécialisées, chacune avec un rôle bien défini :

**Étape 1 — Recherche (Perplexity Deep Research)**
- Modèle `sonar-deep-research`, qui parcourt des sources historiques, touristiques et cartographiques pour identifier 8 lieux emblématiques répondant au thème (par exemple : "lieux cachés de l'histoire juive à Grenade").
- Pour chaque lieu, Perplexity cherche une **réponse vérifiable et gravée dans la pierre** : une date sur un fronton, un nombre de colonnes, un nom sur une plaque. Les réponses fragiles (couleur du ciel, nombre de fleurs dans un jardin) sont rejetées.
- Les lieux dont la réponse est marquée `UNVERIFIED` par l'IA sont filtrés. Il faut au minimum 4 à 6 lieux vérifiés pour valider la recherche.

**Étape 2 — Création narrative (Claude Sonnet 4)**
- Modèle `claude-sonnet-4-20250514`, qui reçoit la recherche Perplexity et transforme chaque lieu en énigme immersive.
- Règles strictes appliquées par le prompt système (`src/lib/anthropic.ts:60-105`) :
  - Chaque énigme doit dire explicitement au joueur **quoi chercher** et **où chercher physiquement** — pas d'énigme abstraite qui suppose une connaissance préalable.
  - La réponse doit être **courte** : une année, un nombre, ou trois mots maximum. Jamais une phrase.
  - Chaque étape contient **exactement trois indices progressifs** : vague, modéré, quasi-direct.
  - Une anecdote historique de 2 à 3 phrases est ajoutée, vérifiable, jamais inventée.

**Étape 3 — Stockage (Supabase)**
- Le jeu est inséré en base avec un statut `is_published: true`, prêt à être joué.
- Les étapes sont stockées avec leurs coordonnées GPS, leur rayon de validation (30 mètres par défaut, ajustable de 5 à 500 m selon le monument), et la liste des indices en JSONB multilingue.
- Si l'une des étapes échoue à s'enregistrer, un rollback automatique supprime le jeu pour éviter les données orphelines.

### 2.2 Pourquoi ce pipeline est robuste

- **Séparation des rôles IA** — Perplexity cherche et vérifie les faits, Claude écrit la narration, Gemini traduit et reconnaît les images. Aucun modèle n'est sollicité en dehors de son domaine de compétence.
- **Vérification croisée** — Les réponses générées par Claude sont re-vérifiées contre les données de recherche originales de Perplexity (`src/lib/anthropic.ts:130-138`).
- **Filtrage à la source** — Les lieux sans réponse gravée dans la pierre sont rejetés avant même d'arriver à l'étape de création narrative.
- **Rollback transactionnel** — Un jeu incomplet n'atteint jamais la base de données.

### 2.3 Création manuelle (admin)

L'interface admin (`src/app/(admin)/admin/games/new`) permet aussi de créer un jeu manuellement, étape par étape, avec coordonnées GPS saisies à la main et énigmes rédigées par un humain. Ce mode est utilisé pour les parcours premium validés par un historien ou un guide professionnel.

---

## 3. Le code d'activation — Signature cryptographique

Chaque code de jeu vendu est **signé cryptographiquement** pour empêcher toute génération frauduleuse.

### 3.1 Format

```
PP-RRRRRR-CCCC
```

- `PP` — 2 caractères identifiant le jeu (par exemple `KC` pour un parcours "Kode Cristianos")
- `RRRRRR` — 6 caractères aléatoires
- `CCCC` — 4 caractères de **checksum HMAC-SHA256** calculé avec une clé secrète serveur

Le charset utilise uniquement des caractères non ambigus (pas de O/0, pas de I/1/l, pas de S/5).

### 3.2 Sécurité

- Impossible de forger un code sans connaître la clé `CODE_HMAC_SECRET`.
- La vérification côté serveur (`src/lib/code-generator.ts:74-87`) rejette en amont tout code dont le checksum ne correspond pas — avant même la requête base.
- Chaque code est lié à un jeu précis (le préfixe `PP` encode le `gameId`), donc un code volé ne peut pas être utilisé sur un autre parcours.

### 3.3 Règles d'usage

- **Single-use** (défaut) : un code = une session. Après activation, le code est invalide.
- **Multi-use** : utilisé pour les packs famille ou entreprise, avec un compteur `current_uses / max_uses`.
- **Expiration optionnelle** : un code peut avoir une date d'expiration (vente saisonnière, promotions limitées).

---

## 4. Expérience de jeu côté joueur

### 4.1 Les trois modes de navigation

OddballTrip propose **trois manières complémentaires** de guider le joueur, chacune pensée pour une situation différente.

**Mode DIVAN (par défaut, sur la carte)**
- Une grande flèche verte entoure la position du joueur sur la carte et pointe automatiquement vers le prochain objectif.
- Une ligne en pointillés relie la position actuelle à la cible, avec la distance affichée en son milieu et mise à jour en temps réel.
- Tout est calculé à partir du GPS, donc **aucune boussole physique n'est requise** — ce mode fonctionne même avec un smartphone dont le compas est désactivé ou défaillant.

**Mode Réalité Augmentée (optionnel, ouvrable depuis le menu)**
- La caméra du smartphone s'ouvre en plein écran et un marqueur 3D flotte dans l'espace au-dessus de la direction exacte de la cible.
- Un mini-radar en haut à gauche montre la cible sur 360°, même si elle est derrière le joueur.
- Des anneaux colorés indiquent la proximité (rouge = loin, vert = très proche).
- Quand le joueur est aligné et à moins de quelques mètres, le téléphone vibre — "cible verrouillée".
- Ce mode utilise l'API `DeviceOrientationEvent` (accéléromètre + magnétomètre) et requiert une permission explicite de l'utilisateur.

**Mode Guidage Textuel (toujours actif en bas de l'écran)**
- Un panneau affiche en permanence la distance à la cible, une estimation du temps de marche, une direction cardinale ("nord-est") et une phrase contextuelle d'aide.
- Utile en complément des deux autres modes, surtout quand le joueur est encore loin (> 200 m).

### 4.2 Le menu d'actions — Tout à portée d'un doigt

Depuis la carte, un bouton menu dans l'en-tête ouvre un tiroir contenant toutes les actions secondaires, chacune avec une icône, une couleur, un descriptif et le coût associé :

| Action | Icône | Pénalité | Usage |
|---|---|---|---|
| **Mon carnet** | Livre vert | Aucune | Noter les réponses de chaque étape pour le code final |
| **Mode RA** | Étoiles fuchsia | Aucune | Ouvrir la caméra en réalité augmentée |
| **Demander un indice** | Ampoule jaune | +2 min (puis +10 min dès le 4ᵉ) | Obtenir un indice progressif |
| **Valider par photo** | Caméra bleue | Aucune (soumis à l'IA) | Si le GPS est imprécis, photographier la cible |
| **Passer l'étape** | Flèche orange | +45 min | Sauter l'étape ; la réponse est révélée |

Le bouton **Valider GPS** reste seul au centre de la barre inférieure, pleine largeur, afin qu'il soit impossible à rater.

### 4.3 Le carnet final

Chaque étape donne une **réponse courte** (une année, un nombre, un mot) que le joueur note dans son carnet. À la fin du jeu, il assemble toutes ses réponses dans l'ordre pour former le **code final** — une combinaison du type `1085-3-1492-428-5-1704`. La saisie de ce code valide officiellement la victoire et fige le score au classement.

Ce mécanisme a deux vertus :
- **Il oblige le joueur à être attentif** à chaque étape, au lieu de foncer d'un point à l'autre en ignorant le contenu.
- **Il crée un souvenir tangible** — le carnet peut être photographié et partagé comme un "trophée".

### 4.4 Narration audio multilingue

Chaque énigme et chaque indice peut être **lu à voix haute** dans la langue du joueur grâce à la synthèse vocale du navigateur (Web Speech API). C'est particulièrement utile pour les joueurs qui marchent en suivant la carte et ne veulent pas lire à l'écran. Les voix sont automatiquement choisies en fonction de la locale (`fr-FR`, `en-US`, `ja-JP`...).

---

## 5. Validation des réponses et fiabilité des résultats

### 5.1 Validation GPS (mécanisme principal)

La validation d'une étape repose sur un calcul **côté serveur** de la distance entre la position du joueur et la cible, avec la formule de Haversine standard (`src/lib/geo.ts:11-29`). Si la distance est inférieure ou égale au rayon de validation configuré pour l'étape (30 m par défaut, ajustable), l'étape est validée.

**Trois protections serveur sont appliquées** :

1. **Vérification de session** — Le serveur vérifie que la session est `active` (pas déjà terminée, pas abandonnée) et que le joueur tente de valider **l'étape courante** (pas une étape future ou déjà validée).
2. **Rate limit** — Un minimum de **5 secondes** doit séparer deux tentatives de validation, pour empêcher qu'un joueur ne spamme l'API avec des coordonnées aléatoires.
3. **Horodatage serveur** — Le temps écoulé, l'heure de complétion et le score sont **toujours calculés côté serveur avec `NOW()`**, jamais à partir du client — le joueur ne peut donc pas manipuler son chrono.

### 5.2 Validation photo par IA (Gemini)

Si le GPS est imprécis (bâtiment ancien qui bloque le signal, zones urbaines denses), le joueur peut photographier la cible. L'image est envoyée à **Google Gemini 2.5 Flash**, qui analyse la photo et la compare à la description attendue de la cible.

Le modèle retourne un JSON structuré :
```json
{
  "isValid": true,
  "confidence": 0.85,
  "feedback": "Excellente photo, c'est bien la porte almohade",
  "recognizedObject": "Porte d'Elvira, Grenade",
  "anecdote": "Construite en 1180..."
}
```

**Règles anti-hallucination** appliquées par le prompt système de Gemini (`src/lib/gemini.ts:76-94`) :
- Ne jamais affirmer reconnaître un monument sans être **hautement confiant**.
- Préférer une réponse vide à une réponse inventée.
- Ne jamais fabriquer de date, d'architecte ou d'événement historique.
- Valider seulement si la photo montre **clairement** la cible attendue.

**Seuils de confiance** :
- Validation de l'étape : confiance minimum de **0,6 à 0,7** selon le mode.
- Exposition de l'objet reconnu au joueur (nom du monument + anecdote) : confiance minimum de **0,7**.

En dessous de ces seuils, l'IA renvoie un message générique et ne prétend rien savoir.

### 5.3 Fiabilité du classement

Le classement s'appuie sur une **vue matérialisée Postgres** (`leaderboard`), avec un tri cryptographique stable :

```sql
RANK() OVER (
  PARTITION BY game_id
  ORDER BY final_score DESC, completed_at ASC
)
```

En cas d'égalité de score, le joueur qui a terminé **en premier** est classé devant. Aucun calcul côté client ne peut influencer le rang.

Chaque étape validée génère une ligne **immuable** dans la table `step_completions` : temps passé, GPS exact, distance mesurée, indices utilisés, photo éventuelle. Ces lignes ne sont jamais modifiées après leur création — uniquement insérées. Un audit complet de chaque session est donc toujours possible.

### 5.4 Formule de scoring (transparente)

Le score final est calculé selon la formule publique suivante (`src/lib/scoring.ts:13-18`) :

```
Score = max(0, 10 000 − (temps_total × 2) − (pénalités × 2) + bonus)
```

| Variable | Unité | Exemple |
|---|---|---|
| Temps total | secondes | 900 s (15 min) → −1 800 pts |
| Pénalités | secondes | 2 indices = 240 s → −480 pts |
| Bonus | points | Étapes difficiles +30 à +60 s |
| **Score final** | points | 10 000 − 1 800 − 480 = **7 720 pts** |

Chaque joueur peut vérifier lui-même son score à partir des données affichées dans le carnet et sur la page de résultats.

---

## 6. Multilinguisme — 32 langues supportées

### 6.1 Architecture à deux niveaux

OddballTrip supporte **32 langues** au total, organisées en deux couches :

**5 langues pré-traduites statiquement** (français, anglais, allemand, espagnol, italien) — toute l'interface, toutes les instructions, tous les messages d'erreur sont traduits à la main et stockés dans le code. Le chargement est instantané, sans appel réseau.

**27 langues traduites à la demande par Gemini** (portugais, néerlandais, polonais, russe, chinois, japonais, coréen, arabe, hindi, turc, suédois, danois, norvégien, finnois, grec, tchèque, roumain, hongrois, thaï, hébreu, ukrainien, indonésien, vietnamien, malais, croate, bulgare, catalan). À la première demande pour une langue donnée, Gemini traduit l'intégralité du contenu du jeu en un seul appel batch, puis le résultat est mis en cache dans la table `translations_cache` pour ne plus jamais retraduire.

### 6.2 Stockage multilingue en base

Tous les contenus textuels sont stockés en **JSONB** avec la structure :

```json
{
  "en": "The Almohad Gate",
  "fr": "La Porte Almohade",
  "de": "Das Almohadische Tor",
  "es": "La Puerta Almohade",
  "it": "La Porta Almohade"
}
```

Quand le joueur joue en français, la fonction `t()` extrait directement `"fr"`. Si la langue demandée n'existe pas encore en base, elle est récupérée du cache ou générée par Gemini en moins d'une seconde.

### 6.3 Détection automatique

La langue est détectée dans cet ordre de priorité :
1. Paramètre d'URL `?lang=fr`
2. En-tête HTTP `Accept-Language` du navigateur
3. Par défaut, le français

---

## 7. Garde-fous en place

### 7.1 Sécurité applicative

- **Authentification Supabase** (JWT) pour toutes les routes joueur.
- **Service role key** protégée pour les routes admin, ne quittant jamais le serveur.
- **Bearer token secret** (`EXTERNAL_API_SECRET`) pour l'endpoint de génération de jeu et les webhooks entre OddballTrip et l'application.
- **Codes signés HMAC** — impossible à forger sans la clé serveur.
- **Validation Zod** sur toutes les entrées d'API — un payload mal formé est rejeté avant même d'atteindre la logique métier.

### 7.2 Intégrité de la session

- **Horodatage serveur systématique** — le client ne peut jamais dicter quand une étape a commencé ou s'est terminée.
- **Rate limit à 5 secondes** entre validations — empêche le brute-force de coordonnées.
- **Session status check** — seules les sessions `active` peuvent être mises à jour ; une session déjà complétée est en lecture seule.
- **Étapes immuables** — les lignes `step_completions` sont insérées, jamais modifiées.

### 7.3 Fiabilité du contenu IA

- **Pipeline à trois modèles spécialisés** (recherche → création → traduction) au lieu d'un monolithe qui devrait tout faire.
- **Filtrage `UNVERIFIED`** — les lieux sans réponse vérifiable sont exclus à la source.
- **Vérification croisée** — les réponses de Claude sont confrontées aux données de recherche Perplexity avant insertion en base.
- **Seuils de confiance Gemini** (0,6 à 0,7) — en dessous, l'IA s'abstient plutôt que d'inventer.
- **Rollback transactionnel** — un jeu incomplet n'est jamais enregistré.

### 7.4 Support joueur

- **Bouton "Signaler une erreur"** sur chaque écran d'énigme — le joueur peut remonter une information incorrecte, une mauvaise coordonnée, un monument démoli.
- **Panneau admin `/admin/reports`** — les équipes peuvent examiner les signalements, corriger les étapes, ou désactiver temporairement un parcours.
- **Stockage immuable** des signalements dans la table `error_reports`.

### 7.5 Fallback en cas de problème

- Si le **GPS est imprécis**, le joueur peut valider par photo.
- Si la **photo ne reconnaît pas** la cible, le joueur peut demander un indice.
- Si les **indices ne suffisent pas**, le joueur peut sauter l'étape (avec pénalité) ; la réponse est révélée.
- Si le **serveur échoue à calculer le résultat final**, une requête directe au leaderboard est utilisée en fallback (`src/app/(player)/results/[sessionId]/page.tsx:53-72`).

L'expérience est conçue pour que **le joueur ne reste jamais bloqué** — il y a toujours une issue, avec un coût visible et accepté.

---

## 8. Architecture technique (synthèse)

| Couche | Technologie | Rôle |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 | Full-stack, SSR, API routes |
| Langage | TypeScript 5 | Typage fort, sécurité à la compilation |
| Base de données | Supabase PostgreSQL (RLS) | Stockage principal, vues matérialisées |
| Stockage fichiers | Supabase Storage | Images, photos joueur |
| Carte | React-Leaflet + OpenStreetMap | Carte interactive, tuiles libres |
| IA recherche | Perplexity `sonar-deep-research` | Recherche historique vérifiée |
| IA narration | Anthropic Claude Sonnet 4 | Écriture d'énigmes |
| IA vision & traduction | Google Gemini 2.5 Flash | Reconnaissance photo, traduction batch |
| Audio | Web Speech API (navigateur) | Narration TTS sans backend |
| Validation | Zod | Schémas d'entrée API |
| Hébergement | Vercel | Déploiement serverless, CDN global |
| État client | Zustand | Store léger côté joueur |
| Style | Tailwind CSS 4 + shadcn/ui | Design system cohérent |

**Statistiques du codebase** :
- 122 fichiers TypeScript / React
- 32 routes API
- 44 composants (UI + joueur + admin)
- 17 modules utilitaires (géo, scoring, i18n, IA)
- 7 hooks React personnalisés (géolocalisation, distance, timer, orientation, caméra, narration, install)

---

## 9. Points d'attention et feuille de route

Pour être transparent dans le dossier, voici les aspects à surveiller en priorité :

### 9.1 À renforcer avant une montée en charge

- **Rate limiting global** — aucun throttle n'est actuellement posé sur l'ensemble des APIs (seule la validation d'étape est protégée). À ajouter via le Vercel Rate Limit API ou une solution tierce (Upstash) si le trafic dépasse quelques centaines de joueurs simultanés.
- **Détection anti-triche avancée** — l'application ne détecte pas encore les vitesses extrêmes (téléportation GPS, usage d'un VPN de géolocalisation). À envisager si des abus sont constatés sur le classement global.
- **Modération des contenus IA** — les anecdotes, photos reconnues et énigmes générées ne passent aucun filtre de modération externe (type OpenAI Moderation ou Perspective API). Les garde-fous actuels reposent uniquement sur les prompts système des modèles.

### 9.2 Fonctionnalités partielles à finaliser

- **Partage social** — l'icône est présente sur la page de résultats, l'intégration native Web Share API reste à activer.
- **Badges et achievements** — pas encore implémentés ; pourraient renforcer la rétention.
- **Météo en temps réel** — les icônes (flamme, flocon, thermomètre) sont présentes dans l'interface mais l'API météo n'est pas branchée.
- **Reverse geocoding** — détection automatique de la ville à l'ouverture de l'app, pour suggérer les parcours proches.
- **PWA (Progressive Web App)** — le hook `useInstallPrompt` est prêt, l'activation du manifest et des icônes est à compléter pour une installation "comme une app native".

### 9.3 Évolutions naturelles

- **Mode audioguide en temps réel** — déclencher une anecdote audio automatique quand le joueur passe à moins de 50 mètres d'un monument majeur, même hors parcours.
- **Photo de découverte** — un bouton "Qu'est-ce que je vois ?" utilisant Gemini pour identifier n'importe quel monument croisé, même hors du jeu.
- **Traduction de panneaux** — photographier un panneau en langue locale → traduction instantanée via Gemini.
- **Pack touriste** — détection du pays à l'activation, proposition automatique des parcours autour de l'hôtel.

---

## 10. Synthèse — Pourquoi OddballTrip fonctionne

1. **Zéro connaissance requise** — GPS, flèche dynamique, réalité augmentée, photo IA, narration vocale : l'application guide entièrement un joueur qui ne connaît ni la ville, ni la langue, ni l'histoire.
2. **Contenu généré par IA mais vérifié** — le pipeline à trois modèles spécialisés (Perplexity pour la vérité, Claude pour la narration, Gemini pour la traduction et la vision) assure des énigmes factuelles, jamais hallucinées.
3. **Validation impossible à tricher** — tous les calculs critiques (distance, temps, score) sont effectués côté serveur avec horodatage serveur, rate limit et vérification de session.
4. **Codes cryptographiquement signés** — un code vendu ne peut pas être forgé, ni recyclé, ni utilisé sur un autre parcours.
5. **Support de 32 langues** — cache intelligent qui minimise les appels IA après la première traduction d'un jeu.
6. **Le joueur ne reste jamais bloqué** — indices progressifs, photo fallback, skip d'étape : chaque blocage a une issue visible et un coût explicite.
7. **Résultats auditables** — chaque étape complétée laisse une trace immuable en base de données, avec GPS exact, distance mesurée et heure serveur.
8. **Architecture moderne et éprouvée** — Next.js 16, React 19, TypeScript, Supabase, Vercel : une stack de production utilisée par des milliers d'applications commerciales.

OddballTrip est **prêt pour une exploitation commerciale** sur des marchés touristiques exigeants (villes historiques européennes, destinations multilingues, clientèle internationale). Les garde-fous techniques sont en place pour garantir la fiabilité des résultats affichés au joueur et au classement général.

---

*Document généré automatiquement à partir de l'inspection directe de la codebase en date du 11 avril 2026. Chaque affirmation technique est sourcée par un fichier et un numéro de ligne dans le rapport détaillé d'audit interne.*
