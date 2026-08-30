# ADR-003 — Atomicité de `edit_files`

**Statut : accepté — 29 août 2026**

## Décision

`edit_files` déclare `atomicity: "path_dependency_groups"`. Toutes les opérations sont résolues contre une même source revision de préparation. Le runtime calcule les chemins effectifs après rebase, fusionne les opérations qui écrivent une même ressource ou consomment leur résultat, puis prépare et valide tous les groupes avant le premier commit.

Chaque groupe publie son effet, sa satisfaction, ses révisions avant/après et son reçu. Les groupes indépendants peuvent aboutir malgré le blocage d’un autre groupe. Un rollback incomplet produit obligatoirement un état partiel et un artefact de récupération.

## Conséquences

- Un batch mélangé n’est jamais résumé comme totalement appliqué.
- Deux références anciennes convergeant vers le même chemin sont regroupées après résolution.
- Une absence de changement n’est satisfaite que si la postcondition est démontrée.
- Les préconditions CAS et la validation post-écriture appartiennent au runtime.
- La chaîne publiée est monotone : un groupe sans effet conserve la révision courante atteinte par les groupes précédents, même s’il avait été préparé sur une révision plus ancienne.
