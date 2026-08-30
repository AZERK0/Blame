# ADR-002 — Résultat canonique Harness v3

**Statut : accepté — 29 août 2026**

## Décision

Le contrat canonique est `HarnessResult` version 3. Il sépare `outcome`, `effect`, `satisfaction`, `evidence`, `provenance` et, en cas de blocage, `issue` et `recovery`.

Un résultat de domaine bien formé est toujours un succès de transport. `completed + changed` exige un reçu d’effet ; `completed + none` exige une preuve de postcondition ou d’idempotence. Sans preuve, le résultat est bloqué. Les erreurs sont classées par cause stable : entrée, conflit, code, capacité, infrastructure, politique ou défaut interne.

Le runtime mémorise un appel bloqué par identité normalisée et refuse sa répétition tant que sa `RecoveryCondition` n’est pas satisfaite. Le chemin v3 n’emploie pas le budget d’itérations du gouverneur v2.

## Conséquences

- Les payloads spécialisés restent dans `data` sans enveloppe contradictoire.
- Une incapacité ou un échec de validation n’est pas un crash de transport.
- La projection v2 temporaire est dérivée du reçu v3 et ne déclenche aucun second effet.
- Les effets non prouvés deviennent visibles comme défauts de contrat.
