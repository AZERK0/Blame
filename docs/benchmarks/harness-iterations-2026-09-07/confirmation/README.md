# Reproduction de la confirmation

Ces scripts sont des copies de ceux de la campagne locale, conservées pour audit. Leur emplacement d'exécution est `.blame/benchmarks/terminal-bench-confirmation-20260907/`, avec les archives voisines et le clone `upstream/terminal-bench-2` décrits dans le manifeste. Ils ne s'exécutent pas directement depuis ce dossier documentaire. Les bundles volumineux et journaux bruts restent dans l'archive locale ; les identifiants du fournisseur proviennent de `.env.terminal-bench` et ne sont jamais copiés ici.

`register.py` vérifie l'absence d'un manifeste existant et fige les configurations avant les essais. Le lancement local `run_campaign.py` vérifie les hashes, exécute les six lots, conserve les échecs et retire uniquement les images de tâches créées pour cette campagne lorsqu'aucun conteneur ne les utilise. Le protocole interdit de relancer ce dossier en place.

Après les 36 essais, `collect.py` reconstruit les mesures depuis `jobs/*/*/result.json`, les usages fournisseur et les événements. `audit.py` produit des candidats de contamination à examiner ; les décisions sont enregistrées dans `adjudication.json`, puis la collecte est répétée. `analyze.py` calcule les comparaisons, intervalles par tâche et sensibilités. Il refuse un ensemble autre que les 36 combinaisons uniques attendues et vérifie ses calculs sur un exemple déterministe.

Les résultats attendus ici après clôture sont `trials.csv`, `analysis.json`, les décisions d'audit et le contrôle final d'intégrité. Le protocole et le manifeste actuels sont enregistrés avant l'exécution ; ils ne constituent pas des résultats.
