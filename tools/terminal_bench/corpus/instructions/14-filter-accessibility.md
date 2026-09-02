Rends `ProjectFilter` accessible dans `src/ProjectFilter.tsx` sans changer ses props.

Le champ de recherche doit être de type `search` et posséder un label visible « Search projects » correctement associé avec l'identifiant stable `project-search`. Le bouton de filtre doit être un vrai bouton non-submit, exposer l'état `featuredOnly` avec `aria-pressed` et garder le nom accessible « Featured only » indépendamment de son état. Le texte de résultat doit être annoncé poliment. Ne modifie aucun autre fichier et valide le build.
