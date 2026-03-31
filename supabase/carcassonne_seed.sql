-- ============================================
-- SEED DATA : Escape Game Carcassonne
-- Architecture : TEXT simple (français), traduction Gemini à la volée
-- ============================================

-- ============================================
-- GAME : CARCASSONNE — Le Serment des Parfaits
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
  '55555555-5555-5555-5555-555555555555',
  'Le Serment des Parfaits : Le Secret Cathare de Carcassonne',
  'En l''an 1209, tandis que la Croisade albigeoise consumait le Languedoc, un Parfait cathare dissimula un trésor spirituel au cœur même de la cité. Ses gardiens attendent encore. Saurez-vous honorer le serment des Parfaits ?',
  'Carcassonne',
  4,
  150,
  TRUE,
  3,
  120,
  'Raimond de Pereille',
  'Parfait cathare, gardien des secrets de Montségur, 1209',
  'Je suis Raimond de Pereille, Parfait de l''Église Cathare, et je vous parle depuis l''ombre des siècles. En cet an de grâce 1209, les armées du Nord ont franchi les portes de Carcassonne, brisant notre monde en mille éclats de silence. Avant que tout ne soit perdu, j''ai confié à cette cité de pierre un héritage que nulle flamme ne peut consumer : la sagesse des Purs, le chemin vers la Lumière. Les indices sont gravés dans les murs, dissimulés dans les ombres des tours, murmurant encore dans le vent des Lices. Votre mission, pèlerin, est de suivre le fil de cette mémoire blessée, de lieu en lieu, jusqu''au cœur du mystère. Que votre âme soit aussi droite que votre chemin. Bonne route dans la cité des Cathares.',
  '🕯️'
);

-- ============================================
-- ÉTAPES DU JEU
-- ============================================

-- ÉTAPE 1 — Porte Narbonnaise (entrée principale)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  1,
  'La Porte des Damnés',
  'Ici commence et finit toute chose. Les Croisés ont franchi ce seuil porteurs de croix et de vengeance. Deux tours jumelles veillent sur les vivants et les morts. Entre leurs masques de pierre, cherche le gardien qui regarde vers le midi. Compte ses créneaux du côté gauche. Ce nombre est ta première clé.',
  '7',
  43.20631, 2.36592, 40,
  TRUE,
  'The twin towers of the Narbonnaise Gate at the medieval fortified city of Carcassonne, showing the crenellated battlements and drawbridge area. The player should be photographed standing in front of the main gate arch.',
  '[
    {"order": 1, "text": "Observe attentivement les deux tours de la Porte Narbonnaise. La réponse se trouve sur l''une d''elles."},
    {"order": 2, "text": "Regarde les créneaux — ces dents de pierre au sommet de la tour gauche. Compte-les soigneusement."},
    {"order": 3, "text": "La tour gauche (côté ville) possède 7 créneaux visibles depuis l''entrée principale."}
  ]'::jsonb,
  0
);

-- ÉTAPE 2 — Tour du Trésau (haute surveillance)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  2,
  'La Tour du Trésor',
  'Son nom chuchote encore l''or et les secrets. La plus haute vigie du rempart nord garde dans sa rondeur un emblème taillé dans la pierre : un animal qui ne dort jamais, symbole des comtes de Trencavel. Identifie cet animal pour avancer sur le chemin des Parfaits.',
  'le lion',
  43.20670, 2.36450, 45,
  TRUE,
  'The Tour du Trésau, the tall watchtower on the northern rampart of Carcassonne''s fortified city. Player should photograph the tower from below, ideally showing the stone heraldic detail or the full silhouette against the sky.',
  '[
    {"order": 1, "text": "La Tour du Trésau est l''une des plus hautes de la cité. Cherche un symbole sculpté ou héraldique sur ou près de cette tour."},
    {"order": 2, "text": "Les Trencavel, vicomtes de Carcassonne, avaient un emblème animal dans leurs armoiries."},
    {"order": 3, "text": "Le lion est l''emblème héraldique des Trencavel. C''est la réponse attendue."}
  ]'::jsonb,
  0
);

-- ÉTAPE 3 — Château Comtal (entrée)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  3,
  'Le Cœur du Vicomte',
  'C''est ici que Raimond-Roger Trencavel tint sa cour et reçut les Parfaits comme ses frères. La barbacane qui protège l''entrée du château porte la mémoire d''un siège qui dura quinze jours. Sur l''arc principal de cette barbacane, quel millésime ou symbole de pierre as-tu repéré ? Donne le nombre de claveaux visibles dans l''arche centrale.',
  '11',
  43.20542, 2.36408, 35,
  TRUE,
  'The entrance gate (barbican) of the Château Comtal inside Carcassonne''s fortified city. The player should be photographed in front of the main arched gateway, showing the stonework arch.',
  '[
    {"order": 1, "text": "La barbacane est le petit fort qui précède l''entrée du Château Comtal. Observe attentivement l''arc de l''entrée principale."},
    {"order": 2, "text": "Les claveaux sont les pierres cunéiformes qui forment l''arche. Compte-les dans l''arc central de la barbacane."},
    {"order": 3, "text": "L''arche centrale de la barbacane du Château Comtal est composée de 11 claveaux."}
  ]'::jsonb,
  0
);

-- ÉTAPE 4 — Tour de la Justice
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  4,
  'La Tour du Jugement Dernier',
  'Ici les hérétiques attendaient leur sort, entre les mains de Simon de Montfort et de ses légats. La justice des hommes s''exerçait dans la pierre et le silence. Cette tour porte un nom que les Parfaits prononcaient avec crainte. Sur son côté exposé au levant, cherche une meurtrière en forme de croix. Combien y en a-t-il dans la rangée du milieu ?',
  '3',
  43.20580, 2.36480, 40,
  TRUE,
  'The Tour de la Justice (Tower of Justice) in Carcassonne''s inner ramparts. Player should photograph the tower focusing on the arrow slits (meurtrières) visible on the eastern face, showing the cross-shaped openings in the stonework.',
  '[
    {"order": 1, "text": "La Tour de la Justice se trouve sur le rempart intérieur. Cherche les meurtrières — les fentes étroites dans la pierre pour les archers."},
    {"order": 2, "text": "Certaines meurtrières ont une forme de croix. Repère la rangée horizontale du milieu de la tour."},
    {"order": 3, "text": "La rangée médiane de la Tour de la Justice comporte 3 meurtrières en forme de croix sur la face est."}
  ]'::jsonb,
  0
);

-- ÉTAPE 5 — Les Lices (chemin de ronde entre les deux enceintes)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  5,
  'Le Couloir des Âmes',
  'Entre les deux murailles court un couloir de pierre et d''herbe que les Cathares appellaient la Voie du Milieu — ni dedans ni dehors, ni vie ni mort, un entre-deux où l''âme se purifie. Dans ce passage, les Lices, compte le nombre de tours visibles de part et d''autre en regardant vers le nord. Quel est le total ?',
  '14',
  43.20500, 2.36500, 50,
  TRUE,
  'The Lices (the space between the inner and outer walls) of Carcassonne, showing both the inner and outer ramparts with their towers. Player should be photographed in the middle of this grass corridor between the two walls.',
  '[
    {"order": 1, "text": "Place-toi au centre des Lices, ce couloir d''herbe entre les deux enceintes fortifiées. Regarde vers le nord."},
    {"order": 2, "text": "Compte toutes les tours visibles sur les deux murs (intérieur + extérieur) dans ton champ de vision vers le nord."},
    {"order": 3, "text": "En regardant vers le nord depuis le centre des Lices, on dénombre 14 tours au total entre les deux enceintes."}
  ]'::jsonb,
  0
);

-- ÉTAPE 6 — Basilique Saint-Nazaire (portail)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  6,
  'Le Temple de la Lumière Interdite',
  'Les Cathares croyaient que la lumière divine était emprisonnée dans la matière — quelle ironie que les croisés aient bâti ici un joyau de lumière colorée pour célébrer leur victoire. Les vitraux du chœur content les souffrances des saints. Parmi les apôtres représentés dans la rose du transept nord, trouve celui qui tient une clé dorée. Quel est son prénom ?',
  'Pierre',
  43.20421, 2.36331, 35,
  TRUE,
  'The portal and facade of the Basilique Saints-Nazaire-et-Celse inside Carcassonne''s fortified city. Player should be photographed in front of the main Romanesque portal, showing the carved tympanum and the church entrance.',
  '[
    {"order": 1, "text": "Entre dans la Basilique Saint-Nazaire (ou observe depuis le portail). Cherche les vitraux du transept nord, près du chœur."},
    {"order": 2, "text": "Dans la tradition chrétienne, un seul apôtre est représenté avec une clé — c''est le gardien des portes du paradis."},
    {"order": 3, "text": "Saint Pierre (Pierre) est l''apôtre aux clés. Il est représenté dans la rose du transept avec une clé dorée."}
  ]'::jsonb,
  0
);

-- ÉTAPE 7 — Place du Château / Puits médiéval
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  7,
  'Le Puits des Révélations',
  'L''eau est la mémoire de la roche. Ce puits au cœur de la place fut creusé pour soutenir un siège interminable. Les assiégés y jetaient leurs prières et leurs secrets. Sur la margelle ou la paroi proche, cherche le nombre de pierres qui forment le premier rang circulaire du rebord. Ce nombre t''ouvrira la dernière porte.',
  '24',
  43.20555, 2.36385, 30,
  TRUE,
  'The medieval well (puits) near the Place du Château inside Carcassonne''s fortified city. Player should be photographed next to the well, showing the stone curb (margelle) and the surrounding square.',
  '[
    {"order": 1, "text": "Trouve le puits médiéval sur la Place du Château, à l''intérieur de la cité. Il est entouré d''une margelle en pierre."},
    {"order": 2, "text": "Compte les pierres qui forment le premier anneau circulaire du rebord du puits (la margelle)."},
    {"order": 3, "text": "La margelle du puits médiéval est composée de 24 pierres dans son premier rang circulaire."}
  ]'::jsonb,
  0
);

-- ÉTAPE 8 (FINALE) — Théâtre Jean-Deschamps (amphithéâtre dans les lices)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '55555555-5555-5555-5555-555555555555',
  8,
  'Le Parchemin des Parfaits',
  'Tu es parvenu au terme du chemin, pèlerin. Là où les troubadours chantaient la fin''amor et où résonnaient les voix des Parfaits, les pierres gardent encore leur secret. Ce lieu était autrefois une partie des Lices ; aujourd''hui des voix y résonnent encore sous le ciel étoilé. Le mot de passe final est celui que les Cathares disaient avant toute chose, leur salutation sacrée adressée à la Lumière qui traverse la matière. Ce mot commence par la lettre qui ouvre aussi leur livre saint.',
  'Lumière',
  43.20480, 2.36280, 50,
  TRUE,
  'The Théâtre Jean-Deschamps, an open-air theater built within the Lices of Carcassonne''s fortified city. Player should be photographed in front of the theater entrance or on the stage area with the medieval walls visible in the background.',
  '[
    {"order": 1, "text": "Le Théâtre Jean-Deschamps est un amphithéâtre en plein air aménagé dans les Lices. Cherche l''entrée principale."},
    {"order": 2, "text": "Pense à la cosmologie cathare : les Parfaits croyaient en une dualité entre les ténèbres (matière) et quelque chose de sacré et divin…"},
    {"order": 3, "text": "Pour les Cathares, la salutation sacrée et le principe divin suprême était la Lumière — c''est le mot de passe final."}
  ]'::jsonb,
  180
);

-- ============================================
-- CODES D'ACTIVATION — Carcassonne
-- 1 code = 25€ / 2 codes = 35€ / 3 codes = 45€
-- ============================================
INSERT INTO activation_codes (code, game_id, is_single_use, max_uses, team_name, expires_at)
VALUES
  ('CARC-2026-AAA', '55555555-5555-5555-5555-555555555555', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('CARC-2026-BBB', '55555555-5555-5555-5555-555555555555', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('CARC-2026-CCC', '55555555-5555-5555-5555-555555555555', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('CARC-2026-DDD', '55555555-5555-5555-5555-555555555555', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('CARC-2026-EEE', '55555555-5555-5555-5555-555555555555', TRUE, 1, NULL, '2026-12-31 23:59:59+00');
