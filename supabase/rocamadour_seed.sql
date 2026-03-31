-- ============================================
-- SEED DATA : Escape Game Rocamadour
-- Architecture : TEXT simple (français), traduction Gemini à la volée
-- 1 code = 25€ / 2 codes = 35€ / 3 codes = 45€
-- ============================================

-- ============================================
-- GAME : ROCAMADOUR — La Voie du Miracle
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
  '77777777-7777-7777-7777-777777777777',
  'La Voie du Miracle : Le Secret de Zachée d''Amadou',
  'Il était publicain à Jéricho, trop petit pour voir, grimpé dans un sycomore pour apercevoir le Christ. Des décennies plus tard, il traversa la mer, remonta les gorges du Quercy et disparut dans la falaise. On l''appela Amadour — le serviteur de Dieu. Avant de se fondre dans la roche pour l''éternité, il cacha quelque chose. Ce quelque chose vous attend encore.',
  'Rocamadour',
  3,
  90,
  TRUE,
  3,
  120,
  'Zachée, dit Amadour',
  'Publicain de Jéricho converti par le Christ, ermite des falaises du Quercy, Ier siècle de notre ère',
  'Je m''appelle Zachée. Vous avez peut-être entendu parler de moi — le collecteur d''impôts de Jéricho, trop petit pour voir par-dessus les têtes, grimpé dans un sycomore comme un enfant pour apercevoir son visage. Ce jour-là, Il m''a regardé et a dit : descends, Zachée, j''entre chez toi ce soir. Ma vie a basculé en un souffle. Après Sa mort et Sa résurrection, j''ai traversé la mer avec Véronique, mon épouse bien-aimée, et nous avons erré en Gaule jusqu''à ce que ces falaises calcaires m''arrêtent le cœur. J''ai taillé ma cellule dans la roche, j''ai sculpté l''oratoire de mes propres mains, et j''ai veillé sur Elle — la Vierge Noire — jusqu''à mon dernier souffle. On m''a retrouvé couché dans la pierre, intact, comme si je dormais encore. Mais avant de fermer les yeux, j''ai confié un secret aux falaises de Rocamadour — quelque chose que seul un pèlerin au cœur droit mérite de trouver. Ce pèlerin, aujourd''hui, c''est peut-être toi.',
  '🕯️'
);

-- ============================================
-- ÉTAPES DU JEU
-- ============================================

-- ÉTAPE 1 — L'Hospitalet (belvédère, vue panoramique)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  1,
  'Le Premier Regard',
  'C''est ici que les pèlerins voyaient Rocamadour pour la première fois, et beaucoup tombaient à genoux en pleurant. Depuis ce belvédère, laisse ton regard descendre vers la falaise et compte les tours qui percent le ciel au-dessus des chapelles. Ce nombre sera ta première clé pour entrer dans mon secret.',
  '3',
  44.79950, 1.61700, 40,
  TRUE,
  'Panoramic viewpoint at L''Hospitalet overlooking the cliff village of Rocamadour, showing the medieval sanctuary built into the rock face with its towers and chapels. The player should be photographed with the full village visible in the background below.',
  '[
    {"order": 1, "text": "Depuis le belvédère de L''Hospitalet, observe attentivement les constructions accrochées à la falaise en dessous de toi."},
    {"order": 2, "text": "Cherche les tours qui dépassent au-dessus des toits des chapelles et du château. Compte uniquement les tours verticales visibles."},
    {"order": 3, "text": "On distingue 3 tours qui s''élèvent au-dessus des chapelles depuis ce belvédère."}
  ]'::jsonb,
  0
);

-- ÉTAPE 2 — Porte du Figuier (entrée médiévale)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  2,
  'La Porte des Pèlerins',
  'Des siècles durant, toute âme en quête de pardon devait franchir cette porte avant d''entrer dans la cité sainte. Les pierres de l''arche ont été usées par le souffle de milliers de voyageurs. Regarde l''arc au-dessus de toi : il est fait de pierres taillées, les claveaux. Combien en comptes-tu dans l''arche de cette porte médiévale ?',
  '13',
  44.79820, 1.61580, 30,
  TRUE,
  'The Porte du Figuier, the medieval stone gateway entrance to the village of Rocamadour, showing the arched stone doorway with visible keystone blocks. The player should be photographed standing beneath the arch looking up at the stonework.',
  '[
    {"order": 1, "text": "Observe attentivement l''arc de la Porte du Figuier. Les claveaux sont les pierres en forme de coin qui forment l''arche."},
    {"order": 2, "text": "Compte les pierres une par une en partant de la base gauche jusqu''à la base droite, en passant par la clé de voûte centrale."},
    {"order": 3, "text": "L''arche de la Porte du Figuier est composée de 13 claveaux."}
  ]'::jsonb,
  0
);

-- ÉTAPE 3 — Rue de la Couronnerie (rue principale du bourg)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  3,
  'La Rue des Pèlerins Mouillés',
  'Cette rue portait autrefois le nom de ceux qui fabriquaient les couronnes offertes à la Vierge. Les pèlerins la longeaient en murmurant des prières, les pieds écorchés, les épaules courbées. Sur la façade de pierre en face de toi, cherche une croix sculptée ou un symbole chrétien gravé dans le mur. Sous ce symbole, un nombre est inscrit. Quelle est cette année ?',
  '1148',
  44.79830, 1.61560, 35,
  TRUE,
  'The Rue de la Couronnerie, the main medieval street of Rocamadour lined with stone buildings, showing pilgrims walking between the old stone facades. The player should be photographed on this narrow street with the cliff and chapels visible above.',
  '[
    {"order": 1, "text": "Parcours la Rue de la Couronnerie et cherche sur les façades en pierre une croix sculptée ou un symbole chrétien gravé."},
    {"order": 2, "text": "Cette date correspond à un événement fondateur pour Rocamadour — le début du grand pèlerinage médiéval."},
    {"order": 3, "text": "L''an 1148 marque la redécouverte du corps incorruptible d''Amadour, point de départ de la renommée de Rocamadour."}
  ]'::jsonb,
  0
);

-- ÉTAPE 4 — Grand Escalier (216 marches)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  4,
  'Les Marches de la Pénitence',
  'Voici l''épreuve que je te réservais. Ces marches, certains les ont gravies à genoux, en récitant un Ave Maria à chaque pas. La douleur était leur prière. Elles comptent un nombre précis de degrés — un nombre que les pèlerins connaissent par cœur, car il est aussi le nombre de jours qu''ils passaient parfois en chemin. Quel est le nombre total de marches de ce Grand Escalier ?',
  '216',
  44.79870, 1.61550, 35,
  TRUE,
  'The Grand Escalier (Great Staircase) of Rocamadour, a long stone stairway climbing the cliff face to the sanctuary. The player should be photographed at the base of the staircase looking upward, showing the full length of the steps rising toward the chapels.',
  '[
    {"order": 1, "text": "Le Grand Escalier est célèbre pour le nombre exact de ses marches, un chiffre que les guides touristiques et les panneaux locaux mentionnent souvent."},
    {"order": 2, "text": "Ce nombre se situe entre 200 et 230. Il est divisible par 3 et par 8."},
    {"order": 3, "text": "Le Grand Escalier de Rocamadour compte exactement 216 marches."}
  ]'::jsonb,
  0
);

-- ÉTAPE 5 — Parvis des Églises / Chapelle Notre-Dame (Vierge Noire)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  5,
  'Le Sanctuaire de la Vierge Noire',
  'Tu es arrivé au cœur de tout. C''est ici qu''Elle veille — la Vierge Noire, sculptée dans un bois de noyer sombre, assise sur son trône depuis des siècles. Des rois sont venus s''agenouiller devant Elle : Louis IX, Henri II Plantagenêt, saint Bernard lui-même. Au-dessus de l''entrée de la chapelle, une cloche légendaire est suspendue. Selon la tradition, elle sonne seule lorsqu''un miracle est accordé. De quelle matière est faite cette cloche miraculeuse ?',
  'fer',
  44.79890, 1.61530, 30,
  TRUE,
  'The doorway of the Chapelle Notre-Dame at Rocamadour, showing the entrance to the sanctuary of the Black Virgin. The player should be photographed in front of the chapel entrance with the miraculous bell visible above or nearby.',
  '[
    {"order": 1, "text": "Observe attentivement l''espace au-dessus de l''entrée de la Chapelle Notre-Dame. Une cloche y est suspendue."},
    {"order": 2, "text": "Cette cloche est réputée sonner seule lorsqu''un miracle se produit en mer. Elle est ancienne et de facture simple — pas du bronze précieux, mais un métal plus brut."},
    {"order": 3, "text": "La cloche miraculeuse de Rocamadour est en fer — un matériau humble, comme la foi du pèlerin."}
  ]'::jsonb,
  0
);

-- ÉTAPE 6 — Basilique Saint-Sauveur
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  6,
  'La Nef des Âmes Sauvées',
  'À côté de la chapelle de la Vierge s''élève cette basilique, où les voix des pèlerins résonnent encore dans la pierre. Regarde la façade romane avec soin : elle est divisée en niveaux par des arcatures sculptées. Combien d''arcatures — ces petites arches décoratives — comptes-tu sur le registre inférieur de la façade de la Basilique Saint-Sauveur ?',
  '5',
  44.79895, 1.61525, 30,
  TRUE,
  'The Romanesque facade of the Basilique Saint-Sauveur at Rocamadour, showing the stone arched decorative elements (arcatures) on the lower section. The player should be photographed in front of the basilica facade, facing the stone arches.',
  '[
    {"order": 1, "text": "Observe la façade de la Basilique Saint-Sauveur. Cherche les petites arches décoratives sculptées dans la pierre sur la partie basse de la façade."},
    {"order": 2, "text": "Ces arcatures sont des niches ou arches en relief, régulièrement espacées. Compte celles du registre le plus bas, au niveau des yeux."},
    {"order": 3, "text": "Le registre inférieur de la façade de la Basilique Saint-Sauveur présente 5 arcatures sculptées."}
  ]'::jsonb,
  0
);

-- ÉTAPE 7 (FINALE) — Château (sommet)
INSERT INTO game_steps (
  game_id, step_order, title, riddle_text, answer_text,
  latitude, longitude, validation_radius_meters,
  has_photo_challenge, photo_reference,
  hints, bonus_time_seconds
) VALUES (
  '77777777-7777-7777-7777-777777777777',
  7,
  'Le Secret de la Falaise',
  'Tu as gravi chaque marche, franchi chaque porte, prié devant chaque pierre. Tu mérites maintenant ce que j''ai caché depuis mille ans. Ici, depuis le château au sommet de la falaise, tu vois tout ce que j''ai aimé : les gorges de l''Alzou, la rivière en contrebas, le ciel du Quercy. Avant de te livrer le mot final, réponds à ceci : quel est le nom du fleuve qui serpente au pied de ces falaises et se jette dans le Lot ? C''est lui qui m''a guidé jusqu''ici, en remontant ses eaux silencieuses.',
  'Alzou',
  44.79930, 1.61540, 40,
  TRUE,
  'The château fortress at the top of the cliff of Rocamadour, showing the battlements and towers against the sky. The player should be photographed at the highest accessible point with a panoramic view of the Alzou gorge and the surrounding Quercy landscape below.',
  '[
    {"order": 1, "text": "Regarde vers le bas depuis le château — tu vois un vallon boisé et une rivière qui serpente entre les falaises calcaires."},
    {"order": 2, "text": "Ce cours d''eau est une rivière locale du Quercy qui traverse les gorges de Rocamadour avant de rejoindre le Lot."},
    {"order": 3, "text": "La rivière qui coule au pied des falaises de Rocamadour s''appelle l''Alzou — une rivière souterraine et mystérieuse, digne de garder un secret."}
  ]'::jsonb,
  180
);

-- ============================================
-- CODES D'ACTIVATION — Rocamadour
-- 1 code = 25€ / 2 codes = 35€ / 3 codes = 45€
-- ============================================
INSERT INTO activation_codes (code, game_id, is_single_use, max_uses, team_name, expires_at)
VALUES
  ('ROCA-2026-AAA', '77777777-7777-7777-7777-777777777777', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('ROCA-2026-BBB', '77777777-7777-7777-7777-777777777777', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('ROCA-2026-CCC', '77777777-7777-7777-7777-777777777777', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('ROCA-2026-DDD', '77777777-7777-7777-7777-777777777777', TRUE, 1, NULL, '2026-12-31 23:59:59+00'),
  ('ROCA-2026-EEE', '77777777-7777-7777-7777-777777777777', TRUE, 1, NULL, '2026-12-31 23:59:59+00');
