Active `noUncheckedIndexedAccess` dans `tsconfig.json`, puis adapte uniquement `src/project-index.ts` pour que le projet compile strictement.

`projectTitleAt` doit retourner le titre demandé lorsque l'index existe et `Unknown project` pour un index négatif, hors limites ou non entier. Ne change pas ses paramètres et ne modifie aucun autre fichier. Exécute le build final.
