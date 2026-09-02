Sécurise `normalizeStorageKey` dans `src/storage-path.ts` et fais-lui retourner `string | null`.

La fonction doit normaliser les séparateurs et les segments `.` ainsi que les séparateurs répétés. Elle doit refuser avec `null` les valeurs vides, les chemins absolus, toute traversée `..` y compris encodée ou utilisant des antislashs, et les encodages URI invalides. Une clé normale comme `projects//2026/./hero.jpg` doit devenir `projects/2026/hero.jpg`. Ne modifie aucun autre fichier et exécute le build.
