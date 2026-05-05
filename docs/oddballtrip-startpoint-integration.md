# Oddballtrip → escape-game : ajouter `startPoint` à la requête

## Pourquoi

Chaque fiche de jeu sur oddballtrip dispose déjà d'un point de départ géolocalisé (le lieu où le joueur est invité à se rendre pour démarrer la session). Ce point est la **vraie référence du parcours** — pas le centre administratif de la ville.

Cas d'usage critique : un parcours dans **Montmartre** est valide à Paris, même si Montmartre est à 5 km de l'Île de la Cité. Si le pipeline filtre les landmarks sur leur distance au "centre-ville géocodé", il rejetterait tous les stops Montmartre alors qu'ils forment un parcours parfaitement marchable. La référence doit être le point de départ choisi par l'opérateur.

Sans `startPoint`, le pipeline retombe sur le premier stop géocodé. C'est une heuristique correcte mais imprécise — autant transmettre la valeur autoritaire que vous avez déjà.

## Contrat

Ajouter `startPoint` au body de l'appel `POST /api/games/generate` (ou `POST /api/external/generate-game`) :

```json
{
  "city": "Clervaux",
  "country": "Luxembourg",
  "theme": "The Shadow's Oath",
  "themeDescription": "...",
  "narrative": "...",
  "stops": [...],
  "startPoint": {
    "lat": 50.0545432,
    "lon": 6.0301538
  },
  ...
}
```

## Schéma accepté

Le pipeline accepte trois conventions de nommage pour la longitude au cas où votre représentation interne diffère :

| Format | Exemple |
|---|---|
| `{ lat, lon }` | `{ "lat": 50.0545, "lon": 6.0301 }` |
| `{ latitude, longitude }` | `{ "latitude": 50.0545, "longitude": 6.0301 }` |
| `{ lat, lng }` | `{ "lat": 50.0545, "lng": 6.0301 }` |

`lat` est toujours interprétée comme la latitude. La longitude est cherchée dans `lon`, puis `longitude`, puis `lng`.

## Précision attendue

- WGS84 décimal, 6 chiffres après la virgule recommandés (~10 cm de précision).
- Le point doit être **dans la même ville** que les stops, idéalement à moins de 1,5 km de chacun d'eux.
- Si `startPoint` est à plus de 1,5 km d'un stop, ce stop sera rejeté par le filtre marchabilité et l'auto-discovery cherchera un remplaçant. Donc cohérence stricte : `startPoint` = lieu où le joueur démarre, et tous les stops sont accessibles à pied depuis là.

## Comportement de l'API

| Cas | Comportement pipeline |
|---|---|
| `startPoint` fourni, valide | ✅ Utilisé comme référence du parcours. Filtre 1,5 km appliqué autour. |
| `startPoint` fourni mais malformé (lat/lon manquants) | ⚠ Log warning, fallback sur le 1er stop géocodé. |
| `startPoint` absent | ⚠ Log warning explicite (`MISSING startPoint`), fallback sur le 1er stop géocodé. |

Dans tous les cas, la pipeline continue. La présence de `startPoint` est très fortement recommandée mais pas (encore) bloquante.

## Logs Vercel à surveiller

Dans les Runtime Logs côté escape-game :

```
[GenerateGame] ⚠ MISSING startPoint in payload — oddballtrip must transmit ...
```

ou

```
[Pipeline] Parcours start: operator-provided startPoint at 50.0545,6.0301
[Pipeline] Parcours start: first geocoded operator stop "Castle" at ... (no explicit startPoint from oddballtrip)
```

Le premier message indique qu'oddballtrip n'a pas envoyé le champ. Le second confirme qu'il a été utilisé.

## Vérification rapide côté oddballtrip

Avant le push :
1. Ouvrir une fiche de jeu existante.
2. Vérifier qu'elle a bien un point de départ géolocalisé (lat/lon).
3. Confirmer que ce point est inclus dans le body envoyé à `/api/games/generate`.
4. Tester avec un parcours dans un quartier excentré (ex. Vieux-Lyon depuis le centre Lyon Part-Dieu) — sans `startPoint`, le pipeline va mal filtrer ; avec `startPoint`, tout doit passer.
