-- ============================================
-- SEED DATA : Escape Game Mont Saint-Michel
-- Architecture : TEXT simple (français), traduction Gemini à la volée
-- ============================================

-- ============================================
-- GAME : MONT SAINT-MICHEL — Le Manuscrit de Frère Anselme
-- ============================================
INSERT INTO games (
  id,
  title,
  description,
  city,
  difficulty,
  estimated_duration_min,
  is_published,
  max_hints_per_step,
  hint_penalty_seconds,
  narrator_name,
  narrator_role,
  narrator_intro,
  narrator_avatar
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  'Le Manuscrit de Frère Anselme : L''Énigme de l''Archange',
  'En l''an 1221, un moine enlumineur dissimula dans les pierres du Mont un manuscrit interdit — un texte si dangereux que l''abbé lui-même avait ordonné sa destruction. Ses secrets attendent encore, gravés dans la roche et le silence des marées. Oserez-vous les retrouver avant que la mer ne revienne ?',
  'Mont Saint-Michel',
  4,
  120,
  TRUE,
  3,
  120,
  'Frère Anselme de Brécey',
  'Moine enlumineur à l''abbaye bénédictine du Mont Saint-Michel, XIIIe siècle',
  'Je me nomme Anselme. Frère Anselme de Brécey — pas celui qu''on célèbre dans les chroniques, mais celui qu''on a fait taire. Pendant vingt-deux ans, j''ai courbé l''échine sur mes parchemins dans le scriptorium glacé de cette abbaye, au sommet du rocher que l''Archange a choisi entre tous. J''ai vu des choses. J''ai copié des textes que l''abbé voulait voir brûler. Avant de mourir — de fièvre, disent-ils, mais je sais ce que je sais — j''ai caché mon dernier manuscrit dans les entrailles de ce Mont, pierre après pierre, indice après indice. Ce texte contient la vérité sur une relique que l''abbaye garde secrète depuis le VIIIe siècle. Tu es là. Le Mont t''a laissé passer. C''est signe que tu es celui que j''attendais depuis huit cents ans. Marche avec prudence. La marée ne pardonne pas les retardataires.',
  '✍️'
);

-- ============================================
-- ÉTAPES DU JEU
-- ============================================

-- ÉTAPE 1 — Entrée / Porte de l'Avancée
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  1,
  'Le Seuil de l''Archange',
  'Voilà le premier seuil, pèlerin. Moi, Anselme, je l''ai franchi pour la première fois par une aube de janvier 1199, les pieds gelés dans mes sandales. Cette porte avancée garde le Mont comme un moine garde son silence. Sur les pierres de cet ouvrage fortifié, cherche le nombre de meurtrières taillées dans le mur droit en entrant — ces fentes sombres par où nos archers guettaient les Anglais. Ce nombre sera ta première clé.',
  '3',
  48.63597, -1.51112, 35,
  TRUE,
  'The Porte de l''Avancée, the first defensive gate of Mont Saint-Michel, showing the old stone gatehouse and fortified walls. The player should be photographed standing under or in front of the arched entrance of this outermost gate.',
  '[
    {"order": 1, "text": "Observe attentivement les murs de la Porte de l''Avancée. Cherche les fentes verticales étroites taillées dans la pierre pour les archers."},
    {"order": 2, "text": "Regarde le mur droit (côté droit en entrant vers le Mont). Les meurtrières — fentes de tir — y sont taillées en rangée."},
    {"order": 3, "text": "Le mur droit de la Porte de l''Avancée présente 3 meurtrières visibles depuis l''entrée."}
  ]'::jsonb,
  0
);

-- ÉTAPE 2 — Grande Rue
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  2,
  'La Rue des Pèlerins',
  'Des milliers de pèlerins ont usé ces pavés avant toi. Moi, je les regardais depuis les hauteurs avec une certaine pitié — ils cherchaient un miracle, et moi je savais que les vraies merveilles étaient gravées dans la pierre, pas dans les prières. La Grande Rue porte encore les traces du passé. Cherche, sur l''une des façades anciennes de cette rue montante, une enseigne sculptée ou peinte représentant un animal. Quel est cet animal ?',
  'l''agneau',
  48.63580, -1.51090, 40,
  TRUE,
  'The Grande Rue of Mont Saint-Michel, the main cobblestone street leading up through the village with its medieval buildings and shop fronts. The player should be photographed in the middle of this narrow winding street, showing the old stone facades on both sides.',
  '[
    {"order": 1, "text": "Remonte la Grande Rue en regardant attentivement les façades et les enseignes des maisons médiévales."},
    {"order": 2, "text": "Cherche une enseigne ou un relief sculpté représentant un animal. Le symbole chrétien de l''agneau est très présent dans les enseignes de pèlerinage."},
    {"order": 3, "text": "L''Agnus Dei — l''agneau de Dieu — était l''emblème des pèlerins du Mont. Cherche une enseigne à l''effigie de l''agneau sur l''une des façades de la Grande Rue."}
  ]'::jsonb,
  0
);

-- ÉTAPE 3 — Église Saint-Pierre
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  3,
  'La Chapelle du Prince des Apôtres',
  'Pierre — celui qui a renié trois fois avant de régner sur l''Église. J''aimais cette ironie. Cette petite église du village est dédiée à lui, et elle cachait l''une de mes stations. Sur le portail de l''église Saint-Pierre, observe le tympan ou le linteau au-dessus de la porte. Quel objet tient le saint sculpté en son centre ? Donne-moi son nom en un seul mot.',
  'clé',
  48.63556, -1.51080, 35,
  TRUE,
  'The façade and entrance portal of the Église Saint-Pierre on Mont Saint-Michel, showing the church doorway with its carved stonework and tympanum. The player should be photographed in front of the church entrance, with the door visible behind them.',
  '[
    {"order": 1, "text": "Approche-toi du portail de l''église Saint-Pierre et observe attentivement le tympan (la zone sculptée au-dessus de la porte)."},
    {"order": 2, "text": "Saint Pierre est toujours représenté avec un attribut particulier dans l''iconographie chrétienne — l''objet qui symbolise son pouvoir de « lier et délier »."},
    {"order": 3, "text": "Saint Pierre tient une clé — la clé du paradis. C''est son attribut invariable dans toute représentation sculptée ou peinte."}
  ]'::jsonb,
  0
);

-- ÉTAPE 4 — Escaliers vers l'abbaye (Grand Degré)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  4,
  'Le Grand Degré — L''Escalier du Ciel',
  'Combien de fois ai-je gravi ces marches, les bras chargés de parchemins, en soufflant comme un vieux bœuf ? Chaque marche est une prière, disait l''abbé. Chaque marche est une douleur, pensais-je. Compte les marches de la première volée de l''escalier extérieur qui mène à l''abbaye — depuis le palier du bas jusqu''au premier palier intermédiaire. Ce nombre t''attend.',
  '40',
  48.63535, -1.51062, 40,
  TRUE,
  'The Grand Degré, the steep exterior staircase leading up to the abbey of Mont Saint-Michel. The player should be photographed at the base of this impressive stone staircase, showing the full flight of steps rising towards the abbey entrance above.',
  '[
    {"order": 1, "text": "Place-toi au bas du Grand Degré, le grand escalier extérieur qui monte vers l''abbaye. Tu dois compter les marches de la première volée."},
    {"order": 2, "text": "Compte les marches depuis le palier du bas jusqu''au premier palier intermédiaire (là où l''escalier marque une pause avant de continuer)."},
    {"order": 3, "text": "La première volée du Grand Degré extérieur compte environ 40 marches jusqu''au premier palier intermédiaire."}
  ]'::jsonb,
  0
);

-- ÉTAPE 5 — Abbaye / Portail Ouest
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  5,
  'Le Portail de l''Archange',
  'Enfin — les portes de l''abbaye elle-même. C''est ici que j''ai senti pour la première fois le poids de l''Archange sur mes épaules. Ce portail classique du XVIIIe siècle a remplacé l''entrée romane que je connaissais. Mais la pierre garde sa mémoire. Au-dessus du portail principal, dans les ornements de la façade de la salle des gardes, compte le nombre d''arches ou de baies visibles sur la rangée supérieure de cette façade. Quel est ce nombre ?',
  '6',
  48.63598, -1.51175, 40,
  TRUE,
  'The West entrance of the Abbey of Mont Saint-Michel, showing the guardroom façade and the main gateway into the abbey complex. The player should be photographed in front of the abbey entrance gate, with the large fortified facade visible behind them.',
  '[
    {"order": 1, "text": "Recule légèrement pour voir l''ensemble de la façade de la salle des gardes (Châtelet) qui précède l''entrée de l''abbaye."},
    {"order": 2, "text": "Regarde la rangée supérieure de cette façade : elle est percée d''ouvertures régulières. Compte ces arches ou baies de gauche à droite."},
    {"order": 3, "text": "La façade du Châtelet de l''abbaye présente 6 baies visibles dans sa rangée supérieure."}
  ]'::jsonb,
  0
);

-- ÉTAPE 6 — Cloître
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  6,
  'Le Jardin Suspendu des Moines',
  'Ah, le cloître. Mon refuge. Mon paradis de pierre au sommet du monde. J''y ai passé des heures à observer les colonnettes jumelles, à chercher dans leurs chapiteaux sculptés les visages que l''Archange voulait peut-être me montrer. La Merveille gothique qu''ils ont bâtie là est un miracle d''équilibre — un jardin suspendu entre ciel et mer. Dans ce cloître, les colonnettes sont disposées en quinconce sur deux rangées. Compte le nombre de colonnettes que tu vois sur UN SEUL côté du cloître, de l''angle à l''angle. Ce nombre est ma sixième clé.',
  '18',
  48.63605, -1.51190, 30,
  TRUE,
  'The cloister of the Abbey of Mont Saint-Michel, showing the famous double row of slender columns arranged in a checkerboard pattern, with the garden in the center. The player should be photographed inside the cloister walk, showing the elegant Gothic colonnettes and the garden beyond.',
  '[
    {"order": 1, "text": "Entre dans le cloître et choisis l''un des quatre côtés du déambulatoire. Regarde la rangée de colonnettes qui borde le jardin."},
    {"order": 2, "text": "Les colonnettes sont disposées en quinconce sur deux rangées décalées. Compte toutes les colonnettes visibles sur UN côté complet, de l''angle gauche à l''angle droit."},
    {"order": 3, "text": "Chaque côté du cloître du Mont Saint-Michel présente 18 colonnettes dans sa rangée principale."}
  ]'::jsonb,
  0
);

-- ÉTAPE 7 — Crypte des Gros Piliers
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  7,
  'Les Piliers du Monde Souterrain',
  'Descends. Descends encore. Là où la lumière hésite et où la roche se souvient d''être montagne. La crypte des Gros Piliers supporte tout le poids du chœur gothique au-dessus — une forêt de colonnes massives qui portent le ciel. C''est ici que j''ai dissimulé l''avant-dernière pièce de mon secret. Compte les piliers circulaires massifs qui s''alignent dans cette crypte. Leur nombre est ma septième clé.',
  '10',
  48.63590, -1.51200, 35,
  TRUE,
  'The Crypte des Gros Piliers (Crypt of the Great Pillars) beneath the choir of Mont Saint-Michel abbey, showing the massive cylindrical stone columns supporting the vaulted ceiling. The player should be photographed among these imposing pillars, showing the low vaulted ceiling and the thick stone columns.',
  '[
    {"order": 1, "text": "Tu es dans la crypte qui supporte le chœur gothique. Cherche les piliers cylindriques massifs — les « gros piliers » qui donnent leur nom à la crypte."},
    {"order": 2, "text": "Parcours la crypte en entier et compte tous les piliers circulaires qui soutiennent la voûte, de l''entrée au fond."},
    {"order": 3, "text": "La crypte des Gros Piliers compte 10 piliers cylindriques massifs qui portent le poids du chœur de l''abbatiale."}
  ]'::jsonb,
  0
);

-- ÉTAPE 8 (FINALE) — Remparts / Tour Boucle
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '66666666-6666-6666-6666-666666666666',
  8,
  'La Tour des Secrets Révélés',
  'Te voilà au terme de ton chemin, pèlerin. Moi, Anselme, je t''ai guidé pas à pas depuis les sables jusqu''ici, aux remparts qui défièrent les Anglais pendant cent ans. La Tour Boucle veille sur la baie. De là, par temps clair, tu peux voir les deux rives de ce monde — Normandie et Bretagne — séparées par ces sables traîtres qui avalèrent tant de pèlerins imprudents. Mon manuscrit parle de ce que l''Archange Michel murmure à ceux qui regardent la mer du haut des remparts. Sa parole est celle que les moines chantaient à matines, l''heure où le silence est le plus épais. Ce mot unique, que les bénédictins chantent depuis Saint Benoît lui-même, est ta clé finale. Il commence par la lettre gravée sur l''écusson de l''abbaye.',
  'Ora',
  48.63540, -1.51030, 50,
  TRUE,
  'The ramparts and Tour Boucle of Mont Saint-Michel, showing the medieval defensive towers and walls with the panoramic view of the bay below. The player should be photographed on or near the rampart walk, with the vast bay of Mont Saint-Michel visible in the background.',
  '[
    {"order": 1, "text": "Tu es sur les remparts près de la Tour Boucle. Pense à la règle de Saint Benoît et au mot central de la vie monastique bénédictine."},
    {"order": 2, "text": "Les bénédictins vivent selon la règle « Ora et Labora » — prie et travaille. L''une de ces deux actions est la plus sacrée, celle du matin à matines."},
    {"order": 3, "text": "Le mot de passe final est « Ora » — priez. C''est le premier commandement de la règle bénédictine, et la lettre O est bien gravée dans les armoiries de l''abbaye."}
  ]'::jsonb,
  180
);

-- ============================================
-- CODES D'ACTIVATION — Mont Saint-Michel
-- 1 code = 25€ / 2 codes = 35€ / 3 codes = 45€
-- ============================================
INSERT INTO activation_codes (code, game_id, is_single_use, max_uses, team_name, expires_at)
VALUES
  ('MSM-2026-AAA', '66666666-6666-6666-6666-666666666666', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('MSM-2026-BBB', '66666666-6666-6666-6666-666666666666', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('MSM-2026-CCC', '66666666-6666-6666-6666-666666666666', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('MSM-2026-DDD', '66666666-6666-6666-6666-666666666666', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('MSM-2026-EEE', '66666666-6666-6666-6666-666666666666', TRUE, 1, NULL, '2026-12-31 23:59:59+00');
