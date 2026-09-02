Lis deux fois de suite exactement la même vue brute de `src/api/projects.ts`, sans autre lecture entre les deux appels.

Modifie ensuite uniquement `normalizeProjectTitle` afin qu'un titre vide après `trim()` devienne `"Untitled project"`. Exécute le build et termine.
