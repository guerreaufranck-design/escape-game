# 📚 Bibliothèque de 50 thèmes pré-validés — escape games oddballtrip

Chaque thème respecte le contrat **escape-game intent-first** :

- ✅ Zone compacte (rayon 1-2 km)
- ✅ Narration tendue (mystère, complot, malédiction…)
- ✅ Drame physiquement déroulé dans la zone
- ✅ ≥ 8 monuments documentés disponibles
- ✅ startPoint GPS validé

**Usage** : importer dans la base de données oddballtrip ou utiliser comme catalogue pour la génération automatique. Chaque entrée est prête à être envoyée à `POST /api/games/generate`.

---

## 🇬🇷 GRÈCE (8 thèmes)

### 1. Delphes — la prophétie qui a perdu Crésus
```json
{
  "city": "Delphi, Greece",
  "country": "Greece",
  "theme": "Delphes — la prophétie qui a perdu Crésus",
  "themeDescription": "En 547 av. J.-C., un roi consulta la Pythie. Il interpréta de travers et perdit son empire en six mois. Marche le sanctuaire et trouve le détail qu'il a manqué.",
  "narrative": "Été 547 av. J.-C. Crésus, roi de Lydie, dépêche ses émissaires à Delphes pour savoir s'il doit attaquer Cyrus le Perse. La Pythie répond en transe : « Si tu traverses l'Halys, un grand empire tombera. » Crésus comprend : ce sera l'empire perse. Il attaque. Six mois plus tard, c'est SON empire qui s'effondre. Aujourd'hui, tu remontes la Voie Sacrée du Sanctuaire d'Apollon, du Trésor des Athéniens jusqu'au Temple, du Théâtre au Stade. Quelque part, dans la pierre, le détail que Crésus a manqué attend que tu le retrouves.",
  "startPoint": { "lat": 38.4824, "lon": 22.5010 },
  "stopCount": 8
}
```

### 2. Plaka — le code de la Tour des Vents
```json
{
  "city": "Plaka, Athens, Greece",
  "country": "Greece",
  "theme": "Plaka — le code de la Tour des Vents",
  "themeDescription": "1827. Athènes ottomane. Un derviche cache un code dans les huit faces d'une horloge antique. Décrypte les vents et trouve son secret.",
  "narrative": "1827. Athènes est encore sous occupation ottomane mais la révolution gronde. Mehmet de Konya, derviche soufi, vit dans une cellule au pied de la Tour des Vents — l'horloge gréco-romaine du IIe siècle av. J.-C. Il aurait codé l'emplacement du trésor d'une communauté grecque exilée dans les huit faces de la tour, chacune représentant un vent. Six mois plus tard, Mehmet disparaît. Le trésor n'a jamais été retrouvé. Aujourd'hui, tu remontes des Vents jusqu'à l'Agora romaine, des marches d'Anafiotika au monastère de Kapnikarea, en suivant les huit vents qu'il a gravés dans la pierre.",
  "startPoint": { "lat": 37.9745, "lon": 23.7270 },
  "stopCount": 8
}
```

### 3. Acropolis — le code caché du voile d'Athéna
```json
{
  "city": "Acropolis, Athens, Greece",
  "country": "Greece",
  "theme": "Acropolis — le code caché du voile d'Athéna",
  "themeDescription": "Tous les quatre ans, les Athéniens offraient un voile brodé à Athéna. Une année, le voile contenait un message politique caché. Décrypte-le.",
  "narrative": "Été -440. Périclès domine Athènes mais ses ennemis politiques tissent leur toile. Cette année, lors des Panathénées, le péplos offert à la statue chryséléphantine d'Athéna Parthénos a été brodé en secret par Aspasie, compagne de Périclès. Le voile contiendrait, dans ses motifs, un avertissement à son amant : un complot se trame contre lui. Décrypte les figures du voile en remontant le rocher sacré, du Propylées à l'Erechthéion, du Parthénon au temple d'Athéna Niké, et trouve qui voulait abattre Périclès.",
  "startPoint": { "lat": 37.9715, "lon": 23.7257 },
  "stopCount": 8
}
```

### 4. Mycènes — la malédiction des Atrides
```json
{
  "city": "Mycenae, Greece",
  "country": "Greece",
  "theme": "Mycènes — la malédiction des Atrides",
  "themeDescription": "Agamemnon est rentré victorieux de Troie. Sa femme l'a tué dans son bain. Reconstitue le crime qui a maudit toute sa lignée pendant trois générations.",
  "narrative": "1180 av. J.-C. Agamemnon, roi de Mycènes, rentre triomphant après dix ans devant Troie. Sa femme Clytemnestre l'attend, le sourire faux. Elle ne lui a jamais pardonné le sacrifice de leur fille Iphigénie pour faire souffler le vent vers Troie. Ce soir-là, dans le bain royal, elle le tue avec son amant Égisthe. Sept ans plus tard, leur fils Oreste reviendra venger son père en tuant sa propre mère. La malédiction des Atrides ne s'éteindra qu'avec les Érinyes. Aujourd'hui, tu franchis la Porte des Lions, descends dans le Trésor d'Atrée, parcours les tombes royales du Cercle A. Reconstitue le crime — et comprends pourquoi cette famille était maudite avant même qu'Agamemnon ne naisse.",
  "startPoint": { "lat": 37.7311, "lon": 22.7561 },
  "stopCount": 8
}
```

### 5. Olympie — l'olympiade falsifiée de 396 av. J.-C.
```json
{
  "city": "Olympia, Greece",
  "country": "Greece",
  "theme": "Olympie — l'olympiade falsifiée de 396 av. J.-C.",
  "themeDescription": "Coup de théâtre aux 96e Jeux Olympiques : un juge corrompu, un athlète éliminé à tort, un sanctuaire en émoi. Découvre qui a triché.",
  "narrative": "Été -396, les 96e Jeux Olympiques ouvrent à Olympie. Le sprinter Eupolemos d'Élis arrive favori du stadion, l'épreuve reine. Mais à l'arrivée, les juges helladonikes le déclarent battu par un outsider de Syracuse. La foule hurle au scandale. Trois juges sont accusés d'avoir touché des pots-de-vin. Les statues des Zanes — les Zeus de l'humiliation — seront érigées en bordure du stade pour rappeler la triche. Aujourd'hui, tu marches du Temple de Zeus à la Palestre, du Bouleutérion au Stade, du Philippéion au Métroon. Quelque part dans le sanctuaire, la preuve de la corruption attend.",
  "startPoint": { "lat": 37.6379, "lon": 21.6303 },
  "stopCount": 8
}
```

### 6. Mykonos vieux port — le trésor du capitaine Mardochée
```json
{
  "city": "Mykonos Old Port, Greece",
  "country": "Greece",
  "theme": "Mykonos vieux port — le trésor du capitaine Mardochée",
  "themeDescription": "1872 : un marchand séfarade disparaît avec un coffre venu d'Alger. Indices dans les ruelles cycladiques de la Petite Venise.",
  "narrative": "Mars 1872. Le brick Estrella arrive à Mykonos en provenance d'Alger. À bord, Mardochée Frances, marchand séfarade, transporte un coffre dont le contenu n'est connu que de lui. Trois jours plus tard, l'Estrella repart sans Mardochée. Le coffre n'est plus à bord. Aucun témoin ne l'a vu quitter le port. Mardochée laisse derrière lui des notes en ladino dans les tavernes de la Petite Venise, des marques sur les portes blanches d'Alefkándra, un signe sur le moulin de Bonis. Aujourd'hui, tu suis ses traces du port à Paraportiani, des moulins de Kato Mili au monastère Panagia Tourliani de Tria Pigadia. Le coffre est toujours là, quelque part dans les pierres de Chora.",
  "startPoint": { "lat": 37.4453, "lon": 25.3266 },
  "stopCount": 8
}
```

### 7. Rhodes — la onzième tour des Chevaliers
```json
{
  "city": "Rhodes Old Town, Greece",
  "country": "Greece",
  "theme": "Rhodes — la onzième tour des Chevaliers",
  "themeDescription": "Les Chevaliers de Saint-Jean ont construit dix tours pour défendre la cité. Mais une onzième tour, secrète, abritait leur vrai trésor avant la chute de 1522.",
  "narrative": "Décembre 1522. Soliman le Magnifique a pris Rhodes après six mois de siège. Le Grand Maître Philippe Villiers de L'Isle-Adam capitule. Les Chevaliers de Saint-Jean partent vers Malte avec leurs étendards et leurs reliques. Mais une rumeur persiste : juste avant la chute, le trésor de l'Ordre — l'icône miraculeuse de la Vierge de Philérimos — a été caché dans une onzième tour, secrète, dont aucune carte ne porte trace. Aujourd'hui, tu remontes la Rue des Chevaliers, traverses le Palais des Grands Maîtres, longes les remparts de la Porte Marine à la Porte d'Amboise. Les dix tours connues sont là. La onzième attend que tu la trouves.",
  "startPoint": { "lat": 36.4456, "lon": 28.2237 },
  "stopCount": 8
}
```

### 8. Heraklion — le labyrinthe oublié de Knossos
```json
{
  "city": "Heraklion, Crete, Greece",
  "country": "Greece",
  "theme": "Heraklion — le labyrinthe oublié de Knossos",
  "themeDescription": "1900, Sir Arthur Evans fouille Knossos. Mais le vrai labyrinthe n'est pas au palais — il est caché dans la vieille ville d'Héraklion. Décrypte les fresques.",
  "narrative": "Mars 1900. Sir Arthur Evans, archéologue britannique, achète une colline en Crète et commence à fouiller le palais de Knossos. Il découvre fresques, bains royaux, salle du trône. Mais il manque LE labyrinthe — celui où Thésée aurait tué le Minotaure. Hypothèse : le palais lui-même n'est pas le labyrinthe ; le labyrinthe est codé dans les fresques. Décodé, il pointerait vers un site dans la vieille ville d'Héraklion. Evans n'a jamais publié sa découverte. Aujourd'hui, tu marches du Musée Archéologique au Loggia Vénitienne, de la Cathédrale Saint-Minas à la Fontaine Morosini, des Murailles à la Forteresse Koules. Le labyrinthe est ici, dans les pierres de la cité.",
  "startPoint": { "lat": 35.3387, "lon": 25.1442 },
  "stopCount": 8
}
```

---

## 🇫🇷 FRANCE (8 thèmes)

### 9. Vieux Lyon — le pacte des canuts
```json
{
  "city": "Vieux Lyon, France",
  "country": "France",
  "theme": "Vieux Lyon — le pacte des canuts",
  "themeDescription": "1831. Les ouvriers de la soie se révoltent. Trois meneurs disparaissent dans les traboules. Suis leurs traces avant l'arrivée de la troupe royale.",
  "narrative": "Novembre 1831. À Lyon, les canuts vivent dans la misère pendant que leurs maîtres s'enrichissent. « Vivre en travaillant ou mourir en combattant ! » Ils prennent les armes. Trois jours de barricades. La Croix-Rousse tombe à eux. Mais à Vieux Lyon, trois meneurs s'évanouissent dans le labyrinthe des traboules — passages secrets entre les immeubles que seuls les Lyonnais connaissent. Ils auraient signé un pacte avant de disparaître. Aujourd'hui, tu remontes la Rue Saint-Jean, traverses la Cathédrale Saint-Jean, descends dans la Cour des Loges, longes le quai de Saône. Quelque part dans une traboule, le pacte attend.",
  "startPoint": { "lat": 45.7615, "lon": 4.8267 },
  "stopCount": 8
}
```

### 10. Montmartre — le code des artistes 1944
```json
{
  "city": "Montmartre, Paris, France",
  "country": "France",
  "theme": "Montmartre — le code des artistes 1944",
  "themeDescription": "Été 1944, Paris occupé. Un réseau de peintres résistants cache un message dans leurs toiles exposées au Bateau-Lavoir. Décode-le avant la libération.",
  "narrative": "Juillet 1944. Paris vit ses dernières semaines d'occupation. Sur la Butte Montmartre, le Bateau-Lavoir abrite encore quelques peintres restés malgré la guerre. L'un d'eux, Jean-Pierre Rebois, dirige un réseau de résistance qui transmet ses messages via les couleurs et compositions des toiles exposées. Le 13 juillet, il peint sa dernière œuvre — un message sur l'emplacement d'une cache d'armes pour l'insurrection imminente. Mais la Gestapo l'arrête le 14. Sa peinture est confisquée. Le code n'a jamais été décodé. Aujourd'hui, tu montes du Bateau-Lavoir au Sacré-Cœur, de la Place du Tertre au cimetière, du Moulin de la Galette à la Maison Rose. Les couleurs de Rebois sont encore là, dans les rues qui l'ont vu peindre.",
  "startPoint": { "lat": 48.8867, "lon": 2.3431 },
  "stopCount": 8
}
```

### 11. Île de la Cité — le 7e secret de Notre-Dame
```json
{
  "city": "Île de la Cité, Paris, France",
  "country": "France",
  "theme": "Île de la Cité — le 7e secret de Notre-Dame",
  "themeDescription": "Sept gargouilles. Sept secrets. Six ont été retrouvés. Le septième est resté caché depuis 1345. Marche l'île et trouve le dernier.",
  "narrative": "1345. Pierre de Montreuil, maître d'œuvre de Notre-Dame, achève la cathédrale après 182 ans de chantier. Avant de mourir, il aurait caché sept secrets dans la pierre — sept gargouilles, sept énigmes, sept clés à un savoir hermétique transmis par les compagnons bâtisseurs. Six ont été retrouvés au fil des siècles, derniers en 1844 par Viollet-le-Duc lors de sa restauration. Le septième est introuvable. Indice unique : il serait visible depuis l'extérieur de la cathédrale, sur l'Île de la Cité, mais à un seul moment du jour. Aujourd'hui, tu marches autour de Notre-Dame, traverses la Sainte-Chapelle, longes la Conciergerie, atteins le Pont Neuf et le Square du Vert-Galant. Pierre de Montreuil te regarde.",
  "startPoint": { "lat": 48.8530, "lon": 2.3499 },
  "stopCount": 8
}
```

### 12. Père-Lachaise — la 7e tombe
```json
{
  "city": "Père-Lachaise Cemetery, Paris, France",
  "country": "France",
  "theme": "Père-Lachaise — la 7e tombe",
  "themeDescription": "Sept tombes du Père-Lachaise sont liées à un pacte occulte du 19e siècle. Six sont identifiées. La septième attend que tu la trouves.",
  "narrative": "1827. Le cimetière du Père-Lachaise compte déjà 30 000 sépultures. Un cercle d'ésotéristes parisiens s'y réunit secrètement à la pleine lune : Allan Kardec, Eliphas Lévi, et cinq autres dont l'identité reste contestée. Ils auraient scellé un pacte sur sept tombes du cimetière, créant un heptagramme magique invisible mais puissant. Six tombes du pacte sont identifiées par les chercheurs : Kardec lui-même, Lévi, Balzac, Talma, et deux autres. La septième n'a jamais été retrouvée — elle clôt le pacte, et celui qui la trouve hérite de son pouvoir. Tu remontes les divisions 7, 11, 28, 44, 49 et 92, du tombeau de Kardec à celui de Jim Morrison, en passant par celui d'Oscar Wilde. La septième est ici.",
  "startPoint": { "lat": 48.8616, "lon": 2.3936 },
  "stopCount": 8
}
```

### 13. Marais — le secret du Templier
```json
{
  "city": "Le Marais, Paris, France",
  "country": "France",
  "theme": "Marais — le secret du Templier",
  "themeDescription": "1314 : Jacques de Molay est brûlé. Avant l'arrestation, un templier cache le trésor de l'Ordre dans les ruelles du Marais. Suis ses pas.",
  "narrative": "Vendredi 13 octobre 1307. Philippe le Bel ordonne l'arrestation simultanée de tous les templiers du royaume. À Paris, l'enclos du Temple, leur quartier général, est bouclé. Mais avant l'aube, un templier — Geoffroy de Charney, frère du futur martyr — emporte une partie du trésor de l'Ordre et le cache dans les ruelles du Marais voisin, dans des hôtels particuliers complices. Sept ans plus tard, Jacques de Molay brûle sur le bûcher de l'Île aux Juifs. Le trésor n'a jamais été retrouvé. Aujourd'hui, tu remontes la Rue des Rosiers, traverses la Place des Vosges, longes l'Hôtel de Sully, descends vers la Tour Saint-Jacques. Le templier de Charney t'attend.",
  "startPoint": { "lat": 48.8566, "lon": 2.3622 },
  "stopCount": 8
}
```

### 14. Vieux Carcassonne — la 53e tour
```json
{
  "city": "Cité de Carcassonne, France",
  "country": "France",
  "theme": "Vieux Carcassonne — la 53e tour",
  "themeDescription": "La cité a 52 tours documentées. Une 53e, jamais cartographiée, abriterait les archives cathares cachées en 1209.",
  "narrative": "Été 1209. Simon de Montfort assiège Carcassonne lors de la croisade contre les Albigeois. Le vicomte Raymond-Roger de Trencavel négocie. La ville se rend mais pas avant que les Parfaits cathares aient caché leurs livres sacrés — l'Évangile selon les Cathares — dans une tour secrète des remparts. Cette 53e tour n'apparaît sur aucune carte officielle. Les chercheurs en doutent. Mais en 1898, Viollet-le-Duc, lors de sa restauration de la cité, aurait trouvé une porte murée qui ne menait nulle part. Il a refait le mur sans publier. Aujourd'hui, tu remontes les Lices basses, traverses la Porte Narbonnaise, longes la Tour de l'Inquisition, atteins le Château Comtal. La 53e tour est ici.",
  "startPoint": { "lat": 43.2065, "lon": 2.3637 },
  "stopCount": 8
}
```

### 15. Mont Saint-Michel — la prière interdite
```json
{
  "city": "Mont Saint-Michel, France",
  "country": "France",
  "theme": "Mont Saint-Michel — la prière interdite",
  "themeDescription": "1450. Un moine bénédictin trouve une prière hérétique dans les archives de l'abbaye. Il la cache dans le mont. Retrouve-la avant que la mer ne monte.",
  "narrative": "Hiver 1450. Le frère Étienne, copiste à l'abbaye Saint-Michel, découvre dans les archives un manuscrit du IXe siècle contenant une prière à Saint Michel — mais une prière qui contredit le dogme officiel sur la nature des anges. Une hérésie subtile mais condamnable au bûcher. L'abbé veut détruire le texte. Étienne refuse. Il copie la prière sur huit parchemins qu'il cache aux quatre coins du Mont — dans la crypte, dans le réfectoire, dans le scriptorium, dans le cloître. Le huitième est dans la chapelle Saint-Aubert, juste au pied du mont. Étienne meurt en 1451 sans avoir parlé. Aujourd'hui, tu remontes du parking au village, du village à l'abbaye, longes les remparts. La marée montera dans 6 heures.",
  "startPoint": { "lat": 48.6361, "lon": -1.5115 },
  "stopCount": 8
}
```

### 16. Avignon — le 8e pape
```json
{
  "city": "Avignon, France",
  "country": "France",
  "theme": "Avignon — le 8e pape",
  "themeDescription": "Sept papes ont régné à Avignon (1309-1377). La rumeur d'un huitième pape secret, jamais reconnu, persiste. Découvre qui il était.",
  "narrative": "Janvier 1378. Grégoire XI vient de mourir. Officiellement, il est le septième et dernier pape d'Avignon avant le retour à Rome. Mais une rumeur, étouffée par la curie, parle d'un huitième pape — élu en secret par une fraction des cardinaux français pour bloquer le retour à Rome, gardé caché dans le Palais des Papes pendant trois mois avant que le grand schisme d'Occident ne le rende inutile. Son nom n'apparaît nulle part. Pourtant, des fresques dans certaines salles du palais représenteraient huit personnages papaux quand on les compte attentivement. Aujourd'hui, tu remontes des remparts au Palais des Papes, traverses la Cathédrale Notre-Dame des Doms, longes le Petit Palais, descends au Pont Saint-Bénézet. Le 8e pape attend que tu le nommes.",
  "startPoint": { "lat": 43.9519, "lon": 4.8081 },
  "stopCount": 8
}
```

---

## 🇮🇹 ITALIE (8 thèmes)

### 17. Pompéi — la dernière liste de Vespasius
```json
{
  "city": "Pompeii Archaeological Park, Italy",
  "country": "Italy",
  "theme": "Pompéi — la dernière liste de Vespasius",
  "themeDescription": "24 août 79. Vespasius, marchand pompéien, dresse une liste de dettes le matin de l'éruption. Retrouve-la dans les rues figées par les cendres.",
  "narrative": "24 août 79 après J.-C., aube. Marcus Vespasius Galla, marchand de tissus à Pompéi, ouvre son atelier sur la Via dell'Abbondanza. Avant de partir, il grave sur une tablette de cire la liste de huit clients qui lui doivent de l'argent. Six heures plus tard, le Vésuve explose. La cendre engloutit la ville. La tablette est restée quelque part — peut-être chez un client qui ne l'a jamais payée. Les fouilles modernes ont retrouvé tous les corps de la rue. Pas la tablette. Aujourd'hui, tu remontes la Via Stabiana au Forum, traverses le Lupanar et la Maison des Vettii, atteins l'Amphithéâtre. Huit dettes. Huit étapes. Vespasius t'attend.",
  "startPoint": { "lat": 40.7497, "lon": 14.4869 },
  "stopCount": 8
}
```

### 18. Rome Trastevere — la conjuration des Borgia
```json
{
  "city": "Trastevere, Rome, Italy",
  "country": "Italy",
  "theme": "Rome Trastevere — la conjuration des Borgia",
  "themeDescription": "1503. Cesare Borgia complote pour empoisonner son père. Mais le complot fuite dans les tavernes de Trastevere. Découvre qui a parlé.",
  "narrative": "Été 1503. Le pape Alexandre VI Borgia est au sommet de son pouvoir, son fils Cesare consolide les États pontificaux par la guerre. Mais Cesare est ambitieux : il complote pour empoisonner son propre père et prendre la tiare. Le complot est minutieux — la cantarella, poison Borgia, est préparée dans la maison d'une apothicaire de Trastevere. Cinq complices se réunissent dans une taverne près de Santa Maria. L'un d'eux parle. La rumeur monte au Vatican. Le 12 août, Alexandre VI tombe malade. Le 18, il meurt. Cesare aussi tombe malade. Qui a empoisonné qui ? Aujourd'hui, tu remontes du Ponte Sisto à Santa Maria in Trastevere, traverses Piazza Trilussa, atteins San Crisogono. Cinq complices. Une fuite. Trouve qui.",
  "startPoint": { "lat": 41.8869, "lon": 12.4670 },
  "stopCount": 8
}
```

### 19. Venise Cannaregio — l'or du Doge perdu
```json
{
  "city": "Cannaregio, Venice, Italy",
  "country": "Italy",
  "theme": "Venise Cannaregio — l'or du Doge perdu",
  "themeDescription": "1797. Napoléon arrive. Le dernier doge enterre le trésor de la République. Suis ses traces dans les calli avant que Bonaparte n'atteigne le ghetto.",
  "narrative": "12 mai 1797. Ludovico Manin, 120e et dernier doge de Venise, abdique. Napoléon a vaincu la République millénaire. Avant de quitter le Palais Ducal, Manin charge huit hommes de confiance d'enterrer le trésor de Saint-Marc — non pas le trésor officiel (que Napoléon prendra) mais le trésor secret, l'or du Doge, accumulé depuis l'an 697. Les huit hommes se dispersent dans Cannaregio, le quartier nord, le moins fouillé par les Français. Sept caches sont vidées dans les semaines qui suivent. La huitième n'a jamais été trouvée. Aujourd'hui, tu remontes du Ponte delle Guglie à la Madonna dell'Orto, traverses le Ghetto Nuovo, longes les Fondamenta della Misericordia. La huitième cache attend.",
  "startPoint": { "lat": 45.4444, "lon": 12.3275 },
  "stopCount": 8
}
```

### 20. Florence Oltrarno — le 13e disciple
```json
{
  "city": "Oltrarno, Florence, Italy",
  "country": "Italy",
  "theme": "Florence Oltrarno — le 13e disciple",
  "themeDescription": "1492. Botticelli peint sa Cène pour un commanditaire mystérieux. Le tableau a 13 disciples, pas 12. Trouve qui est le 13e.",
  "narrative": "Hiver 1492. Lorenzo le Magnifique vient de mourir. Florence pleure. Sandro Botticelli, dévot fervent, reçoit une commande étrange : peindre une Cène pour un commanditaire qui paie en or comptant mais refuse de signer le contrat. Le tableau, quand Botticelli le livre, contient une particularité scandaleuse : 13 disciples, pas 12. Le 13e a un visage qui ne ressemble à aucun saint connu. Le tableau disparaît immédiatement après livraison. On le dit caché dans une chapelle de l'Oltrarno. Le 13e disciple serait identifiable par les qui le savent. Aujourd'hui, tu remontes du Ponte Vecchio à Santo Spirito, traverses le Palais Pitti, atteins San Frediano in Cestello. Trouve qui est le 13e.",
  "startPoint": { "lat": 43.7681, "lon": 11.2496 },
  "stopCount": 8
}
```

### 21. Naples Spaccanapoli — le pacte du saint
```json
{
  "city": "Spaccanapoli, Naples, Italy",
  "country": "Italy",
  "theme": "Naples Spaccanapoli — le pacte du saint",
  "themeDescription": "Le sang de saint Janvier se liquéfie trois fois par an. Mais une année, il a refusé. Découvre quel pacte oublié l'avait lié à la ville.",
  "narrative": "Septembre 1939. Pour la première fois en 600 ans, le sang de San Gennaro, saint patron de Naples, refuse de se liquéfier lors de la cérémonie. La ville est en émoi — c'est un présage de catastrophe. Trois jours plus tard, l'Allemagne envahit la Pologne. Mais une rumeur, étouffée par l'Église, parle d'un pacte oublié entre Naples et le saint, scellé en 1389 lors de la première liquéfaction publique. Ce pacte aurait été rompu en 1939 par un acte commis dans Spaccanapoli. Aujourd'hui, tu remontes du Duomo à San Domenico Maggiore, traverses la Cappella Sansevero, atteins Santa Chiara, descends à San Gregorio Armeno. Le pacte rompu attend que tu le retrouves.",
  "startPoint": { "lat": 40.8497, "lon": 14.2575 },
  "stopCount": 8
}
```

### 22. Sienne Contrade — le palio truqué de 1701
```json
{
  "city": "Siena, Italy",
  "country": "Italy",
  "theme": "Sienne Contrade — le palio truqué de 1701",
  "themeDescription": "Il y a un palio par contrada. En 1701, le Palio de l'Assomption a été truqué — le contrada gagnant n'aurait jamais dû gagner. Découvre qui a payé qui.",
  "narrative": "16 août 1701. Le Palio de l'Assomption, course de chevaux mythique de Sienne sur la Piazza del Campo, voit triompher la contrada de la Tortue (Tartuca). Mais une rumeur enfle dans les jours qui suivent : trois autres contrade — l'Aigle, la Coquille et la Panthère — auraient payé les jockeys de la Tortue pour empêcher la favorite, l'Oie, de gagner. Le pacte aurait été scellé dans une fontaine de la ville haute. Les archives municipales contiennent encore des allusions cryptées à ce scandale, mais aucune contrada n'a jamais avoué. Aujourd'hui, tu remontes du Duomo à la Piazza del Campo, traverses la Torre del Mangia, longes les fontaines des contrade. Trois contrade ont triché. Trouve lesquelles.",
  "startPoint": { "lat": 43.3185, "lon": 11.3310 },
  "stopCount": 8
}
```

### 23. Vérone — la lettre cachée de Roméo
```json
{
  "city": "Verona, Italy",
  "country": "Italy",
  "theme": "Vérone — la lettre cachée de Roméo",
  "themeDescription": "Roméo aurait écrit une dernière lettre à Juliette avant de boire le poison. Le messager n'est jamais arrivé. La lettre serait à Vérone.",
  "narrative": "1303 (selon la chronique de Da Porto). Romeo Montecchi, banni à Mantoue, apprend la mort apparente de Giulietta Capuleti. Il revient à Vérone, écrit une dernière lettre à sa bien-aimée — non pas la lettre officielle qu'on connaît, mais une seconde, plus secrète, donnée à un messager qu'il a payé pour la cacher dans la ville plutôt que la livrer. Roméo y révèle pourquoi il choisit la mort. Le messager prend l'argent, cache la lettre et fuit la ville pour la peste qui sévit. La lettre n'a jamais été lue. Aujourd'hui, tu remontes de la Casa di Giulietta à l'Arena, traverses la Piazza delle Erbe, longes le Castelvecchio, descends à San Zeno. Le messager a caché la lettre quelque part dans ces pierres.",
  "startPoint": { "lat": 45.4419, "lon": 10.9986 },
  "stopCount": 8
}
```

### 24. Milan Brera — le 9e cadavre de Léonard
```json
{
  "city": "Brera, Milan, Italy",
  "country": "Italy",
  "theme": "Milan Brera — le 9e cadavre de Léonard",
  "themeDescription": "Léonard a disséqué 30 cadavres pour ses études anatomiques. L'un de ses carnets en mentionne 31. Le 9e cadavre serait un meurtre maquillé.",
  "narrative": "1490. Léonard de Vinci, à Milan au service de Ludovic Sforza, étudie l'anatomie humaine en disséquant des cadavres au mépris de l'interdiction papale. Ses 200 dessins anatomiques sont admirés. Mais un de ses carnets, daté du 14 mars 1490, décrit le « neuvième cadavre » avec une particularité : un trou crânien net, pas accidentel. Léonard a noté en marge en miroir : « Ceci n'est pas mort, c'est meurtre. » Il n'a jamais publié. Le cadavre n°9 a disparu des registres de l'hôpital. Aujourd'hui, tu remontes de la Pinacoteca di Brera au Castello Sforzesco, traverses Sant'Ambrogio, atteins Santa Maria delle Grazie où La Cène veille. Léonard sait qui est mort. Toi aussi, à la fin.",
  "startPoint": { "lat": 45.4720, "lon": 9.1880 },
  "stopCount": 8
}
```

---

## 🇪🇸 ESPAGNE (5 thèmes)

### 25. Barcelone Gothic — le diamant des Templiers
```json
{
  "city": "Barri Gòtic, Barcelona, Spain",
  "country": "Spain",
  "theme": "Barcelone Gothic — le diamant des Templiers",
  "themeDescription": "1312. L'Ordre est dissous. Un Templier catalan cache le diamant noir de l'Ordre dans le quartier gothique. Suis les marques sur les pierres.",
  "narrative": "Avril 1312. Le pape Clément V dissout l'Ordre du Temple. À Barcelone, Berenguer de Cardona, dernier maître provincial des Templiers en Aragon, sait que les biens de l'Ordre seront confisqués. Avant l'arrestation, il cache le diamant noir — joyau ramené de Jérusalem, sans doute par les premiers Templiers — dans le quartier juif et gothique de Barcelone. Il marque huit pierres avec un signe templier discret indiquant le chemin. Berenguer est arrêté un mois plus tard. Il meurt en prison sans révéler la cache. Aujourd'hui, tu remontes de la Cathédrale à Plaça Sant Felip Neri, traverses la Plaça del Rei, longes Santa Maria del Pi. Huit signes. Une cache. Le diamant noir t'attend.",
  "startPoint": { "lat": 41.3837, "lon": 2.1776 },
  "stopCount": 8
}
```

### 26. Madrid Austrias — le complot des Habsbourg
```json
{
  "city": "Madrid de los Austrias, Spain",
  "country": "Spain",
  "theme": "Madrid Austrias — le complot des Habsbourg",
  "themeDescription": "1700. Charles II d'Espagne, dernier Habsbourg, meurt sans héritier. Mais avant sa mort, un complot pour changer le testament aurait eu lieu dans le vieux Madrid.",
  "narrative": "Octobre 1700. Charles II « l'Ensorcelé », dernier Habsbourg d'Espagne, agonise au palais de l'Alcázar à Madrid. Sans héritier, sa succession déchirera l'Europe. Le testament officiel désigne le petit Philippe d'Anjou (Bourbon, France) — au grand dam de l'Autriche. Mais une rumeur persiste : un premier testament, plus ancien, désignait l'archiduc Charles d'Autriche. Il aurait été détruit par une cabale pro-française dans les semaines précédant la mort du roi. Les conspirateurs se réunissaient dans une taverne du vieux Madrid. Aujourd'hui, tu remontes de la Plaza Mayor au Palais Royal, traverses la Plaza de la Villa, longes la Catedral de la Almudena. La cabale a laissé des traces. Trouve-les.",
  "startPoint": { "lat": 40.4168, "lon": -3.7077 },
  "stopCount": 8
}
```

### 27. Séville Triana — le testament d'un conquistador
```json
{
  "city": "Triana, Seville, Spain",
  "country": "Spain",
  "theme": "Séville Triana — le testament d'un conquistador",
  "themeDescription": "1542. Un conquistador rentré du Pérou cache son or dans le quartier de Triana. Il meurt avant d'écrire le testament. L'or attend depuis 480 ans.",
  "narrative": "Mai 1542. Pedro de Mendoza, conquistador rentré du Pérou avec dix coffres d'or pillés à l'empire inca, débarque à Séville. La couronne réclame son cinquième royal. Pedro refuse de tout déclarer. Il s'installe à Triana, le quartier ouvrier de Séville sur l'autre rive du Guadalquivir. Il enterre cinq coffres dans cinq endroits différents — chez des amis sûrs. Avant d'avoir pu écrire le testament détaillant les caches, il meurt de la peste. Sa veuve ne sait que ce qu'il avait commencé à dire : « Cinq pierres. Cinq amis. Triana. » Aujourd'hui, tu remontes du Pont de Triana à la Capilla del Carmen, traverses la Plaza del Altozano, longes la Calle Betis. Cinq amis. Cinq caches. Combien retrouveras-tu ?",
  "startPoint": { "lat": 37.3848, "lon": -6.0019 },
  "stopCount": 8
}
```

### 28. Tolède — le 11e Caballero
```json
{
  "city": "Toledo, Spain",
  "country": "Spain",
  "theme": "Tolède — le 11e Caballero",
  "themeDescription": "L'Ordre de Santiago compte 10 chevaliers documentés à Tolède en 1492. Mais l'autel de la cathédrale en représente 11. Trouve qui était le onzième.",
  "narrative": "1492. Année d'expulsion des Juifs et conquête de Grenade. À Tolède, capitale historique d'Espagne, les Caballeros de l'Ordre de Santiago veillent sur la cité multireligieuse. Les archives recensent 10 chevaliers en activité. Mais sur le retable de la Cathédrale Primatiale, achevé cette année-là, on en voit 11 — sculptés en relief autour de saint Jacques. L'identité du 11e n'apparaît dans aucun registre officiel. La rumeur dit qu'il était converso (juif converti) et que sa présence dans l'Ordre était secrète, à une époque où l'Inquisition les chassait. Aujourd'hui, tu remontes de la Cathédrale à Santo Tomé, traverses la Synagogue del Tránsito, atteins le Monastère de San Juan de los Reyes. Le 11e Caballero attend.",
  "startPoint": { "lat": 39.8569, "lon": -4.0273 },
  "stopCount": 8
}
```

### 29. Grenade Albaicín — le dernier soupir de Boabdil
```json
{
  "city": "Albaicín, Granada, Spain",
  "country": "Spain",
  "theme": "Grenade Albaicín — le dernier soupir de Boabdil",
  "themeDescription": "2 janvier 1492. Boabdil rend Grenade aux Rois Catholiques. Mais avant de partir, il cache une lettre dans l'Albaicín. Suis ses traces depuis la Mezquita Mayor.",
  "narrative": "2 janvier 1492. Boabdil, dernier émir nasride de Grenade, remet les clés de l'Alhambra à Isabelle et Ferdinand. La Reconquista s'achève. Avant de quitter la ville pour son exil aux Alpujarras, Boabdil cache dans l'Albaicín — quartier mauresque de Grenade — une lettre adressée à ses fils, contenant l'emplacement du trésor royal nasride et le serment qu'un jour, ils reviendraient. Le messager qui devait livrer la lettre meurt en chemin. La lettre reste dans l'Albaicín. Aujourd'hui, tu remontes du Mirador de San Nicolás à la Plaza Larga, traverses la Mezquita Mayor de Granada (église San Salvador), longes les Cuevas del Sacromonte. Boabdil a laissé son dernier soupir sur ces pierres.",
  "startPoint": { "lat": 37.1816, "lon": -3.5942 },
  "stopCount": 8
}
```

---

## 🇬🇧 ROYAUME-UNI (4 thèmes)

### 30. London Westminster — la conjuration des poudres revisitée
```json
{
  "city": "Westminster, London, United Kingdom",
  "country": "United Kingdom",
  "theme": "London Westminster — la conjuration des poudres revisitée",
  "themeDescription": "5 novembre 1605, Guy Fawkes est arrêté avec ses barils. Mais il y avait un 13e conjurateur jamais identifié. Trouve son nom à Westminster.",
  "narrative": "Nuit du 5 novembre 1605. Guy Fawkes est arrêté dans les caves du Parlement de Westminster avec 36 barils de poudre. Le complot pour faire sauter le roi Jacques Ier et son Parlement est déjoué. Douze conjurateurs sont identifiés et exécutés. Mais le compte rendu d'enquête de Sir Edward Coke mentionne « un treizième homme, qui s'est échappé par la Tamise ». Son nom n'apparaît dans aucun document public. Il aurait laissé une marque, à Westminster même, indiquant son identité — un signe destiné aux autres catholiques, pour qu'ils sachent qui le protéger. Aujourd'hui, tu remontes du Parlement à Westminster Abbey, traverses St Margaret's Church, longes Whitehall, atteins St James's Park. Le treizième conjurateur attend.",
  "startPoint": { "lat": 51.4994, "lon": -0.1245 },
  "stopCount": 8
}
```

### 31. London Whitechapel — l'autre Ripper
```json
{
  "city": "Whitechapel, London, United Kingdom",
  "country": "United Kingdom",
  "theme": "London Whitechapel — l'autre Ripper",
  "themeDescription": "1888. Cinq victimes officielles de Jack the Ripper. Mais une 6e a été cachée par Scotland Yard. Trouve son nom dans les ruelles de Whitechapel.",
  "narrative": "Automne 1888. Jack the Ripper terrorise Whitechapel. Cinq victimes officielles : Polly Nichols, Annie Chapman, Elizabeth Stride, Catherine Eddowes, Mary Jane Kelly. Mais les archives de Scotland Yard, déclassifiées en 1976, contiennent un dossier maigre sur une sixième femme retrouvée dans Mitre Square le 18 octobre 1888. Le rapport est incomplet. La presse n'en a jamais parlé. Pourquoi ? Parce qu'elle était la fille d'un haut fonctionnaire, et qu'on a maquillé sa mort en accident de calèche. Mais les marques sur le corps étaient celles du Ripper. Aujourd'hui, tu remontes de Aldgate East à Mitre Square, traverses Spitalfields, longes Hanbury Street, atteins Buck's Row (renommée). La sixième victime cherche son nom.",
  "startPoint": { "lat": 51.5174, "lon": -0.0727 },
  "stopCount": 8
}
```

### 32. Edinburgh Royal Mile — le treizième sorcier
```json
{
  "city": "Royal Mile, Edinburgh, United Kingdom",
  "country": "United Kingdom",
  "theme": "Edinburgh Royal Mile — le treizième sorcier",
  "themeDescription": "1591. Le procès de North Berwick condamne 12 sorciers pour conspiration contre Jacques VI. Un 13e a échappé. Il vivait sur le Royal Mile.",
  "narrative": "Hiver 1591. Le roi Jacques VI d'Écosse — futur Jacques Ier d'Angleterre — déclenche le plus grand procès en sorcellerie de l'histoire britannique. Le procès de North Berwick condamne 12 sorciers et sorcières accusés d'avoir tenté d'assassiner le roi par tempête démoniaque lors de son retour du Danemark. Tous brûlent. Mais Jacques VI lui-même mentionne dans ses notes privées « un treizième, qui marche encore parmi nous, sur la Mile ». Le treizième a survécu en se cachant en plein jour, sous une identité respectable, dans une maison du Royal Mile d'Édimbourg. Aujourd'hui, tu remontes du Château au Palais d'Holyrood, traverses St Giles' Cathedral, longes le Tron Kirk, atteins Canongate. Le treizième sorcier vit encore quelque part dans ces pierres.",
  "startPoint": { "lat": 55.9498, "lon": -3.1880 },
  "stopCount": 8
}
```

### 33. Bath — le secret romain de la Reine Bladud
```json
{
  "city": "Bath, United Kingdom",
  "country": "United Kingdom",
  "theme": "Bath — le secret romain de la Reine Bladud",
  "themeDescription": "863 av. J.-C. selon la légende. Bladud fonde Bath grâce aux eaux miraculeuses. Les Romains y ajoutent leurs bains. Et un secret. Trouve-le.",
  "narrative": "863 av. J.-C. Le prince Bladud, lépreux exilé, découvre des sources thermales qui le guérissent. Il fonde la ville d'Aquae Sulis. Mille ans plus tard, en 70 ap. J.-C., les Romains s'y installent et construisent les bains les plus somptueux de Bretagne. Mais ils découvrent une chose étrange — les eaux ont des propriétés au-delà du curatif. Les vétérans des Légions y voient des visions. Vespasien ordonne que ces visions soient consignées dans un grimoire caché dans le sanctuaire de Sulis-Minerva. En 410, quand les Romains quittent la Bretagne, le grimoire est muré quelque part dans les bains. Aujourd'hui, tu remontes des Roman Baths à l'Abbaye, traverses la Pump Room, longes le Royal Crescent, descends à Pulteney Bridge. Le grimoire de Sulis attend.",
  "startPoint": { "lat": 51.3811, "lon": -2.3590 },
  "stopCount": 8
}
```

---

## 🇩🇪 ALLEMAGNE / 🇦🇹 AUTRICHE (4 thèmes)

### 34. Berlin Mitte — le code du Mur
```json
{
  "city": "Mitte, Berlin, Germany",
  "country": "Germany",
  "theme": "Berlin Mitte — le code du Mur",
  "themeDescription": "1989. Une cellule de la Stasi cache des dossiers compromettants dans Mitte avant la chute du Mur. Trouve où, avant que les archives n'ouvrent.",
  "narrative": "Octobre 1989. Le Mur va tomber. Le colonel de la Stasi Hans Berger, conscient de l'inéluctable, sait que les archives de la Hauptverwaltung A — service d'espionnage extérieur — vont être saisies. Trois nuits avant le 9 novembre, il transfère huit microfilms contenant les noms des 200 agents Stasi infiltrés en Allemagne de l'Ouest depuis 30 ans. Il les cache dans Mitte, le quartier qu'il connaît depuis l'enfance — dans des recoins de Wilhelmstrasse, derrière la Porte de Brandebourg, sous le Schloss berlinois en ruines. Berger meurt dans un « accident de voiture » deux semaines après la chute. Les microfilms sont toujours là. Aujourd'hui, tu remontes de Brandenburger Tor à Friedrichstrasse, traverses Gendarmenmarkt, longes Bebelplatz. Huit microfilms. Huit emplacements.",
  "startPoint": { "lat": 52.5163, "lon": 13.3777 },
  "stopCount": 8
}
```

### 35. Vienne Innere Stadt — la dernière valse de Mayerling
```json
{
  "city": "Innere Stadt, Vienna, Austria",
  "country": "Austria",
  "theme": "Vienne Innere Stadt — la dernière valse de Mayerling",
  "themeDescription": "30 janvier 1889. L'archiduc Rodolphe se suicide à Mayerling avec sa maîtresse. Mais avant, il a laissé huit lettres à Vienne. Découvre leur destinataire commun.",
  "narrative": "Soir du 29 janvier 1889. L'archiduc Rodolphe, héritier des Habsbourg, dîne pour la dernière fois à la Hofburg. Le lendemain matin, on le trouve mort à Mayerling avec sa maîtresse Marie Vetsera. Suicide officiel. Mais avant de quitter Vienne, Rodolphe a écrit huit lettres et les a remises à différents destinataires dans la ville. Sept ont été retrouvées et publiées (à sa femme, sa mère Sissi, sa sœur Marie-Valérie, etc.). La huitième a disparu — adressée à un destinataire mystérieux que les autres lettres mentionnent en code « M.K. ». Cette personne saurait POURQUOI Rodolphe s'est tué. Aujourd'hui, tu remontes de la Hofburg à Stephansdom, traverses la Staatsoper, longes Graben, atteins l'Albertina. M.K. attend que tu le démasques.",
  "startPoint": { "lat": 48.2082, "lon": 16.3730 },
  "stopCount": 8
}
```

### 36. Salzbourg Altstadt — la note manquante de Mozart
```json
{
  "city": "Altstadt, Salzburg, Austria",
  "country": "Austria",
  "theme": "Salzbourg Altstadt — la note manquante de Mozart",
  "themeDescription": "1781. Mozart compose son Idomeneo. Une note de la partition manuscrite manque. Pas une erreur — une cache. Trouve-la dans la vieille ville.",
  "narrative": "Janvier 1781. Mozart, 25 ans, achève à Salzbourg la partition d'Idomeneo, son premier grand opera seria. Mais il a un secret : il déteste Salzbourg, déteste son patron l'archevêque Colloredo, et prépare sa fuite définitive vers Vienne. Sur la partition manuscrite, à un endroit précis du second acte, il omet délibérément une note — non pas une erreur de copie, mais un signal codé pour son père Léopold. Cette note manquante, si on la trouve et la chante, mène à un message caché dans la vieille ville d'Altstadt — le plan de la fuite de Wolfgang. Léopold n'a jamais répondu. Wolfgang est parti seul. Aujourd'hui, tu remontes de Mozartplatz à Mozarts Geburtshaus, traverses Domplatz, longes les Salzburger Festspiele. La note manquante chante encore.",
  "startPoint": { "lat": 47.7997, "lon": 13.0438 },
  "stopCount": 8
}
```

### 37. Munich Marienplatz — la nuit des Cristaux truquée
```json
{
  "city": "Marienplatz, Munich, Germany",
  "country": "Germany",
  "theme": "Munich Marienplatz — la nuit des Cristaux truquée",
  "themeDescription": "9 novembre 1938. Six commerçants juifs de Munich résistent et cachent des objets précieux dans le centre. Retrouve les caches avant qu'elles ne disparaissent.",
  "narrative": "Soir du 9 novembre 1938. Goebbels lance la Reichskristallnacht — la Nuit de Cristal. À Munich, où le nazisme est né, l'attaque est particulièrement brutale. Six commerçants juifs du centre-ville, sentant l'attaque venir, ont caché des objets précieux dans des recoins du Marienplatz et alentours dans les jours précédents : un livre de prières du XIVe siècle, un manuscrit de la Torah, un chandelier rapporté de Tolède en 1492, des bijoux familiaux, un journal intime, un acte de naissance d'un enfant dont les parents ont déjà fui. Les six commerçants sont déportés. Quatre meurent à Dachau. Deux survivent mais ne reviennent jamais à Munich. Les caches sont toujours là. Aujourd'hui, tu remontes de Marienplatz à Frauenkirche, traverses Viktualienmarkt, longes l'Asamkirche, atteins le Sendlinger Tor.",
  "startPoint": { "lat": 48.1374, "lon": 11.5755 },
  "stopCount": 8
}
```

---

## 🇺🇸 USA (4 thèmes)

### 38. NYC Greenwich Village — le feu de Triangle
```json
{
  "city": "Greenwich Village, New York, United States",
  "country": "United States",
  "theme": "NYC Greenwich Village — le feu de Triangle",
  "themeDescription": "25 mars 1911. 146 ouvrières meurent dans l'incendie de la Triangle Shirtwaist Factory. Les patrons ont fermé les portes. Découvre qui a porté plainte en silence.",
  "narrative": "Samedi 25 mars 1911, 16h40. Au 8e étage de l'Asch Building, à Washington Place, le feu prend dans la Triangle Shirtwaist Factory. En 18 minutes, 146 ouvrières meurent — la plupart juives et italiennes immigrées. Les portes des étages avaient été verrouillées par les patrons Max Blanck et Isaac Harris pour empêcher les pauses. Les patrons sont jugés et acquittés en décembre. Mais en 1913, le contremaître Isidoro Russo dépose un témoignage scellé chez un avocat de Greenwich Village — un témoignage qui aurait condamné les patrons. Le document est resté dans le Village. Personne ne l'a publié. Aujourd'hui, tu remontes du Brown Building (l'Asch rebaptisé) à Washington Square Park, traverses MacDougal Street, longes Bleecker Street. Russo attend qu'on le lise.",
  "startPoint": { "lat": 40.7308, "lon": -73.9954 },
  "stopCount": 8
}
```

### 39. NYC Lower East Side — l'enfant disparu de 1911
```json
{
  "city": "Lower East Side, New York, United States",
  "country": "United States",
  "theme": "NYC Lower East Side — l'enfant disparu de 1911",
  "themeDescription": "Charlie Ross junior, 4 ans, disparaît du Lower East Side en 1911. Premier kidnapping pour rançon de l'histoire moderne. Le corps n'a jamais été retrouvé.",
  "narrative": "1er juillet 1911. Charlie Ross, 4 ans, joue devant son immeuble de la rue Hester dans le Lower East Side. Sa mère le perd de vue cinq minutes. Quand elle revient, il a disparu. Trois jours plus tard, une lettre demande $20,000 de rançon — le premier kidnapping pour rançon documenté en Amérique. La famille paie. Charlie ne revient jamais. La police soupçonne un réseau italien opérant entre Mulberry Street et Delancey, mais aucune arrestation. Le corps n'a jamais été retrouvé. En 1937, un Italien mourant de tuberculose à Bellevue Hospital tente de confesser quelque chose au prêtre — il meurt avant d'achever. Aujourd'hui, tu remontes de Hester Street à Mulberry, traverses Delancey, longes Orchard, atteins le Tenement Museum. Charlie cherche son chemin de retour.",
  "startPoint": { "lat": 40.7178, "lon": -73.9907 },
  "stopCount": 8
}
```

### 40. New Orleans French Quarter — le voodoo et le banquier
```json
{
  "city": "French Quarter, New Orleans, United States",
  "country": "United States",
  "theme": "New Orleans French Quarter — le voodoo et le banquier",
  "themeDescription": "1881. Marie Laveau II, prêtresse voodoo, est consultée par un banquier blanc. Trois jours plus tard, il est ruiné et mort. Reconstitue la malédiction.",
  "narrative": "Été 1881. Marie Laveau II, fille de la légendaire reine du voodoo de la Nouvelle-Orléans, reçoit dans sa maison de St. Ann Street un visiteur improbable : Albert Charleson, banquier blanc de Canal Street, en quête d'aide pour récupérer un amour perdu. Marie accepte. Trois jours plus tard, Charleson est retrouvé mort dans son bureau, ruiné, sa banque a fait faillite, et l'amour qu'il aimait — une jeune femme noire — a disparu. Crime ? Magie ? Vengeance ? Les rapports de police citent huit témoins dans le French Quarter qui ont vu Marie ces trois jours-là. Aujourd'hui, tu remontes de Jackson Square à St. Louis Cathedral, traverses Bourbon Street, longes Royal Street, atteins le Lafitte's Blacksmith Shop. Marie veille encore.",
  "startPoint": { "lat": 29.9511, "lon": -90.0660 },
  "stopCount": 8
}
```

### 41. Boston Beacon Hill — le 9e patriote
```json
{
  "city": "Beacon Hill, Boston, United States",
  "country": "United States",
  "theme": "Boston Beacon Hill — le 9e patriote",
  "themeDescription": "16 décembre 1773 : la Boston Tea Party. Huit organisateurs identifiés. Un neuvième, plus grand encore, a tout planifié dans l'ombre depuis Beacon Hill.",
  "narrative": "Soir du 16 décembre 1773. Les Sons of Liberty, déguisés en Mohawks, jettent le thé britannique dans le port de Boston. Cet acte déclenche la Révolution américaine. Huit organisateurs sont historiquement identifiés : Samuel Adams, John Hancock, Paul Revere et cinq autres. Mais une lettre privée de John Adams datée de 1819, retrouvée dans les archives Adams, mentionne un « neuvième homme, plus essentiel encore que Sam ou Hancock, qui dirigea de Beacon Hill et dont le nom doit rester secret pour l'éternité ». Adams ne révèle jamais l'identité. Le mystère reste entier. Aujourd'hui, tu remontes de la Massachusetts State House au Granary Burying Ground, traverses Charles Street, longes Acorn Street, atteins le Boston Common. Le 9e patriote attend.",
  "startPoint": { "lat": 42.3580, "lon": -71.0635 },
  "stopCount": 8
}
```

---

## 🇯🇵 JAPON (3 thèmes)

### 42. Kyoto Gion — le 47e ronin manquant
```json
{
  "city": "Gion, Kyoto, Japan",
  "country": "Japan",
  "theme": "Kyoto Gion — le 47e ronin manquant",
  "themeDescription": "1703. Les 47 rōnin vengent leur seigneur. Mais l'histoire officielle en compte 46 qui se sont fait seppuku. Le 47e a survécu, caché à Gion.",
  "narrative": "14 décembre 1702. Les 47 rōnin du seigneur Asano d'Akō prennent d'assaut la résidence de Kira Yoshinaka et le tuent pour venger leur maître. Cette vengeance, célébrée dans le Chūshingura, devient le mythe fondateur du bushido. Le shogun ordonne le seppuku. Officiellement, 46 rōnin obéissent. Mais l'un d'eux disparaît — Terasaka Kichiemon. Selon la version officielle, il avait été envoyé en mission. Selon une rumeur jamais confirmée, il a fui à Kyoto, dans le quartier des geishas de Gion, où il a vécu sous un faux nom jusqu'en 1747. Sa tombe ne porterait pas son nom. Aujourd'hui, tu remontes du Yasaka Shrine au Kennin-ji, traverses Hanami-koji, longes le Shirakawa Canal, atteins le Kodai-ji. Terasaka attend qu'on lui rende son nom.",
  "startPoint": { "lat": 35.0036, "lon": 135.7779 },
  "stopCount": 8
}
```

### 43. Tokyo Asakusa — le secret du Sanja Matsuri
```json
{
  "city": "Asakusa, Tokyo, Japan",
  "country": "Japan",
  "theme": "Tokyo Asakusa — le secret du Sanja Matsuri",
  "themeDescription": "1312. Trois pêcheurs trouvent la statue de Kannon dans la Sumida. Mais une quatrième personne était dans le bateau. Les chroniques l'ont effacée.",
  "narrative": "Mars 628 (selon la légende). Trois frères pêcheurs — Hinokuma Hamanari, Hinokuma Takenari et Hajino Nakatomo — pêchent dans la rivière Sumida et remontent dans leurs filets une statue dorée de Kannon, la déesse de la compassion. Cette découverte conduit à la fondation du temple Sensō-ji, plus ancien temple de Tokyo. Mais un manuscrit du XIVe siècle, redécouvert en 1923 après le tremblement de terre, mentionne « le quatrième dans le bateau, dont le nom a été effacé du registre ». Cette quatrième personne aurait reçu de Kannon un secret transmis aux abbés successifs du Sensō-ji jusqu'au XVIIe siècle, puis perdu. Aujourd'hui, tu remontes de Kaminarimon au Sensō-ji, traverses Nakamise-dōri, longes le Sumida, atteins l'Asakusa Shrine. Le quatrième pêcheur attend.",
  "startPoint": { "lat": 35.7148, "lon": 139.7967 },
  "stopCount": 8
}
```

### 44. Hiroshima Naka — la cloche silencieuse
```json
{
  "city": "Naka, Hiroshima, Japan",
  "country": "Japan",
  "theme": "Hiroshima Naka — la cloche silencieuse",
  "themeDescription": "6 août 1945, 8h15. Une cloche du quartier Naka aurait sonné juste avant l'explosion. Personne ne l'a frappée. Découvre laquelle.",
  "narrative": "6 août 1945, 8h14 du matin. Hiroshima vit ses dernières secondes normales. À 8h15, le bombardier Enola Gay largue la bombe. Le quartier de Naka, au centre de la ville, est l'épicentre. 80 000 personnes meurent dans les premières minutes. Mais des survivants éloignés rapportent un détail troublant : juste avant la détonation, une cloche aurait tinté dans Naka — une cloche que personne n'avait frappée. Les rapports de l'occupation américaine, déclassifiés en 1995, mentionnent « la cloche prophétique » comme un phénomène acoustique inexpliqué. Sept temples bouddhistes et shintō existaient dans Naka cette matinée-là. Six ont leurs cloches détruites par le souffle. La septième a survécu. Aujourd'hui, tu remontes du Mémorial de la Paix au Dôme de Genbaku, traverses le Sanctuaire Gokoku, longes Honkawa, atteins Hiroshima Castle. La cloche cherche encore son sonneur.",
  "startPoint": { "lat": 34.3955, "lon": 132.4536 },
  "stopCount": 8
}
```

---

## 🇲🇽 / 🇵🇪 / 🇪🇬 (3 thèmes — Mexique, Pérou, Égypte)

### 45. Mexico City Centro Histórico — le codex perdu de Cortés
```json
{
  "city": "Centro Histórico, Mexico City, Mexico",
  "country": "Mexico",
  "theme": "Mexico City Centro — le codex perdu de Cortés",
  "themeDescription": "1521. Cortés détruit Tenochtitlán. Mais avant le brûlement des codex, l'un d'eux est sauvé par un prêtre aztèque et caché dans le centre. Trouve-le.",
  "narrative": "13 août 1521. Hernán Cortés prend Tenochtitlán après 75 jours de siège. Cuauhtémoc, dernier tlatoani, se rend. Les conquistadors brûlent les codex aztèques par milliers — préservation officielle, en réalité destruction systématique de la mémoire indigène. Mais un prêtre, Tlilxochitl, sauve un codex unique : celui qui contenait l'histoire vraie de l'arrivée des Espagnols vu par les Aztèques. Il le cache dans les ruines du Templo Mayor avant d'être exécuté. Le codex est resté là, sous ce qui deviendra le Zócalo de Mexico. Aujourd'hui, tu remontes de la Plaza de la Constitución au Templo Mayor, traverses la Catedral Metropolitana, longes le Palacio Nacional, atteins l'antigua Casa de Hernán Cortés. Le codex de Tlilxochitl attend.",
  "startPoint": { "lat": 19.4326, "lon": -99.1332 },
  "stopCount": 8
}
```

### 46. Cusco — le huitième Inti Raymi
```json
{
  "city": "Cusco, Peru",
  "country": "Peru",
  "theme": "Cusco — le huitième Inti Raymi",
  "themeDescription": "Sept Inti Raymi (fête du Soleil) ont été célébrés depuis 1944. Un huitième aurait eu lieu en secret en 1781, sous l'Inquisition. Trouve où.",
  "narrative": "24 juin 1781. L'Inquisition espagnole interdit depuis 200 ans les cérémonies incas. Mais les descendants des Sapa Inca, malgré la torture, n'ont jamais cessé de célébrer en secret l'Inti Raymi — fête du soleil au solstice d'hiver. Cette année-là, alors que la rébellion de Túpac Amaru II vient d'être écrasée et que les autorités traquent ses partisans, trente nobles incas se réunissent à Cusco pour un dernier Inti Raymi clandestin. Ils choisissent un site qu'aucun Espagnol ne soupçonnerait — un édifice colonial bâti sur les fondations d'un temple inca. La cérémonie a lieu. Tous sont tués trois mois plus tard, mais le site n'est jamais découvert. Aujourd'hui, tu remontes de la Plaza de Armas au Qoricancha, traverses la Catedral, longes l'Iglesia de la Compañía, atteins Sacsayhuamán. Le huitième Inti Raymi a laissé des marques.",
  "startPoint": { "lat": -13.5320, "lon": -71.9675 },
  "stopCount": 8
}
```

### 47. Le Caire Khan El Khalili — la 8e merveille de Saladin
```json
{
  "city": "Khan El Khalili, Cairo, Egypt",
  "country": "Egypt",
  "theme": "Le Caire Khan El Khalili — la 8e merveille de Saladin",
  "themeDescription": "1188. Saladin remporte Jérusalem. Une partie du butin — la 8e merveille jamais nommée — est cachée dans le souk médiéval du Caire. Trouve-la.",
  "narrative": "Octobre 1187. Saladin reprend Jérusalem aux Croisés. Le butin est immense. Une partie est expédiée à Damas, une autre à Bagdad. Mais une troisième partie, la plus mystérieuse, est ramenée au Caire et confiée au sultan Al-Adil, frère de Saladin : un objet que les chroniques arabes nomment seulement « la huitième merveille », sans description. Al-Adil le cache dans le marché Khan El Khalili — le grand souk médiéval. Il aurait laissé huit indices dans les pierres pour ses descendants. Aucun descendant n'a retrouvé l'objet. Au XVe siècle, le marché est rebâti par le mamelouk Jaharkas El Khalili — qui aurait peut-être trouvé l'objet, peut-être pas. Aujourd'hui, tu remontes du Khan El Khalili à la mosquée Al-Hussein, traverses la mosquée Al-Azhar, longes Bayn al-Qasrayn. La 8e merveille attend toujours.",
  "startPoint": { "lat": 30.0479, "lon": 31.2624 },
  "stopCount": 8
}
```

---

## 🇲🇦 / 🇹🇷 / 🇷🇺 (3 thèmes — Maroc, Turquie, Russie)

### 48. Marrakech Médina — le pacte des sept saints
```json
{
  "city": "Médina, Marrakech, Morocco",
  "country": "Morocco",
  "theme": "Marrakech Médina — le pacte des sept saints",
  "themeDescription": "Sept saints protègent Marrakech. Mais un pacte mystérieux les unit depuis 1551 — un pacte qui est sur le point d'expirer. Trouve-le avant.",
  "narrative": "1551. Le sultan saadien Moulay Abdellah Al-Ghalib réunit secrètement les sept marabouts les plus respectés du Maroc à Marrakech : Sidi Bel Abbès, Sidi Youssef Ben Ali, Sidi Soheil, Cadi Ayyad, Imam Souhayli, Abdelaziz Tabbaa et Abdellah Al-Ghazwani. Ils signent un pacte spirituel pour protéger la ville pendant 500 ans. Le pacte est consigné dans un parchemin caché dans les sept zaouïas (mausolées) — chaque saint en garde un fragment. Le pacte expire le... ce mois-ci. Si on le retrouve avant minuit du dernier jour, il peut être renouvelé. Sinon, Marrakech perd sa protection. Aujourd'hui, tu remontes de la Place Jemaa el-Fna à la Médersa Ben Youssef, traverses la Koutoubia, longes les souks, atteins le Palais Bahia. Sept saints. Sept fragments.",
  "startPoint": { "lat": 31.6258, "lon": -7.9892 },
  "stopCount": 8
}
```

### 49. Istanbul Sultanahmet — la 7e bibliothèque de Constantinople
```json
{
  "city": "Sultanahmet, Istanbul, Turkey",
  "country": "Turkey",
  "theme": "Istanbul Sultanahmet — la 7e bibliothèque de Constantinople",
  "themeDescription": "1453. Mehmed II prend Constantinople. Six bibliothèques byzantines sont saisies. Une septième, secrète, contenait les manuscrits les plus précieux. Trouve-la.",
  "narrative": "29 mai 1453. Mehmed II le Conquérant prend Constantinople. La capitale chrétienne devient ottomane. Les bibliothèques impériales — six, recensées par les chroniqueurs — sont saisies, leur contenu en partie pillé, en partie conservé. Mais l'archimandrite Constantin, garant des manuscrits secrets de l'Église, avait constitué depuis 1402 une septième bibliothèque, totalement secrète, contenant les ouvrages les plus précieux : l'Évangile selon les Esséniens, la Bibliothèque de Photios complète, des codex platoniciens disparus. La 7e bibliothèque était cachée sous le Grand Palais. Constantin meurt sur les remparts. Le secret meurt avec lui. Aujourd'hui, tu remontes de Sainte-Sophie à la Mosquée Bleue, traverses la Citerne Basilique, longes Topkapi, atteins le Grand Palais (en ruines).",
  "startPoint": { "lat": 41.0082, "lon": 28.9784 },
  "stopCount": 8
}
```

### 50. Saint-Pétersbourg Vassilievski — le 13e décembriste
```json
{
  "city": "Vasilyevsky Island, Saint Petersburg, Russia",
  "country": "Russia",
  "theme": "Saint-Pétersbourg Vassilievski — le 13e décembriste",
  "themeDescription": "14 décembre 1825. Les décembristes échouent contre le tsar Nicolas Ier. Cinq exécutés, des centaines exilés. Un 13e meneur, jamais identifié, vit sur Vassilievski.",
  "narrative": "14 décembre 1825. Les officiers décembristes refusent l'allégeance au nouveau tsar Nicolas Ier et massent leurs régiments sur la Place du Sénat à Saint-Pétersbourg. Échec total. Cinq meneurs sont pendus, 121 exilés en Sibérie. Mais les archives privées du 3e département (police politique), déclassifiées en 1991, mentionnent « le treizième conjuré, dont l'identité ne doit jamais être révélée ». Cette personne aurait été le véritable cerveau de la révolte, protégé par la cour parce qu'apparenté à un Romanov. Il aurait vécu sur l'île Vassilievski, à Saint-Pétersbourg, jusqu'en 1855. Aujourd'hui, tu remontes des Strelka aux palais de Menchikov, traverses la Bourse, longes les sphinx égyptiens, atteins l'Université. Le 13e décembriste t'attend dans l'ombre.",
  "startPoint": { "lat": 59.9437, "lon": 30.3017 },
  "stopCount": 8
}
```

---

## 📌 Notes d'usage

**Pour oddballtrip back-office :**
1. Importer ces 50 thèmes dans la table `themes_catalog`.
2. Quand l'opérateur crée une nouvelle fiche, proposer ce catalogue en autocomplete par ville/pays.
3. Avant publication, appeler `POST /api/games/check-viability` côté escape-game pour valider qu'aucun monument n'a fermé / déménagé depuis la rédaction du thème.
4. Au moment de l'achat client, appeler `POST /api/games/generate` avec le payload du thème.

**Pour générer plus de thèmes :** utiliser le prompt `oddballtrip-theme-prompt.md` avec un LLM (Claude / GPT-4) en lui donnant ce catalogue comme exemple. Chaque nouveau thème doit passer le check-viability avant publication.
