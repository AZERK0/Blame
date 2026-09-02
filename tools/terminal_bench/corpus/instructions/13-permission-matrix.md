Corrige la matrice de droits dans `src/permissions.ts`.

- `owner` peut effectuer toutes les actions dans tous les états ;
- `viewer` peut uniquement voir un projet ;
- `editor` peut voir tout projet, modifier un projet `draft` ou `published`, et publier uniquement un brouillon ; il ne peut jamais supprimer ni modifier/publier un projet archivé ;
- une valeur inconnue reçue à l'exécution doit être refusée.

Préserve la signature et les types publics. Ne modifie aucun autre fichier et exécute le build.
