# ADR-004 — Evidence Plan et completion

**Statut : accepté — 29 août 2026**

## Décision

La completion est une décision de domaine distincte du terminal de lifecycle. Un `EvidencePlanner` révisionné dérive les obligations depuis les changements, les risques, le graphe borné, les critères d’acceptation, le catalogue de tâches et le snapshot de capacités. Il réutilise uniquement les preuves fraîches et choisit un ensemble déclaré minimal de validations.

Le coordinateur calcule ce plan avant validation, exécute chacun des checks sélectionnés, persiste leurs reçus, puis recalcule la décision depuis ces preuves. Le solveur exact est borné ; au-delà de seize obligations ou trente-deux candidats, une couverture gloutonne déterministe remplace le DP exponentiel.

La valeur `verified` proposée par le modèle n’est pas une preuve. Le Core dérive `delivery`, `verification` et les réserves depuis les reçus. Une livraison satisfaite mais imparfaitement vérifiée peut terminer avec un lifecycle réussi et une réserve explicite ; une preuve fraîche d’erreur conduit à un échec.

## Conséquences

- `submit_and_exit` ne décide pas seul du niveau de vérification.
- Les preuves sont liées à la source revision, aux blobs et à la politique.
- Une validation échouée identique n’est pas rejouée avant une condition de récupération pertinente.
- Le lifecycle reste une machine d’exécution et ne duplique pas la décision produit.
- L’intention non mutante provient explicitement du contrat de tâche ; l’absence de changement observé ne permet jamais de l’inférer.
