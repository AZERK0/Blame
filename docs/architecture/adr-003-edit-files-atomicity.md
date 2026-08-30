# ADR-003 — Atomicité de `edit_files`

**Statut : accepté, amendé — 30 août 2026**

## Décision

`edit_files` déclare `atomicity: "all"` par défaut. Toutes les opérations sont résolues contre une même source revision de préparation, puis préparées et validées avant un commit unique. Un move et ses autres opérations appartiennent toujours au même atome. Un échec de résolution, de précondition ou de validation empêche toute écriture ; un échec pendant le commit déclenche le journal de rollback.

Une application partielle exige `atomicity: "independent_groups"`. Dans ce mode explicite, le runtime calcule les chemins effectifs après rebase et fusionne les opérations qui écrivent une même ressource ou consomment leur résultat. Chaque groupe publie son effet, sa satisfaction, ses révisions avant/après et son reçu. Un rollback incomplet produit obligatoirement un état partiel et un artefact de récupération.

## Conséquences

- Un batch par défaut n’expose jamais une écriture partielle récupérable comme un succès.
- Les groupes indépendants ne sont disponibles que par choix explicite du caller.
- Deux références anciennes convergeant vers le même chemin sont regroupées après résolution.
- Une absence de changement n’est satisfaite que si la postcondition est démontrée.
- Les préconditions CAS et la validation post-écriture appartiennent au runtime.
- La chaîne publiée est monotone : un groupe sans effet conserve la révision courante atteinte par les groupes précédents, même s’il avait été préparé sur une révision plus ancienne.
