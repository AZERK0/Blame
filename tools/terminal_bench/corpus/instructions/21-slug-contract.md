Fais évoluer ensemble `src/slug.ts` et `src/project-url.ts`.

`slugifyProject` doit désormais recevoir un objet `{ id, title }`. Il doit retirer les diacritiques, produire uniquement des segments ASCII minuscules séparés par un tiret, sans tirets de bord ou répétés. Si le titre ne produit aucun caractère utile, utilise `project-<id>`. `projectUrl` doit continuer à produire `/projects/<slug>` en passant le projet complet au helper. Préserve `ProjectLink`, ne modifie aucun autre fichier et exécute le build.
