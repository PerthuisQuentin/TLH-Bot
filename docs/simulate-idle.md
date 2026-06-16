# Simulation idle game

Ce document explique comment lancer et parametrer le script de simulation locale de la progression shells.

Script: `scripts/simulate-idle.ts`

## Objectif

Le script simule une activite de messages locale, sans Discord ni ecriture dans `files/`, en reutilisant:

- la liste des upgrades (`ALL_UPGRADES`)
- le calcul des couts (`getUpgradeCost`)
- le calcul des gains (`getUpgradeGain`)
- la formule `shells/message` (additif puis multiplicatif)

Regle d'achat:

- a chaque message, le script achete automatiquement l'upgrade la moins chere tant qu'elle est abordable.

## Affichage live

Le script fait un clear console a chaque rafraichissement puis reaffiche l'etat complet.
La vitesse de la simulation est controlee par le parametre `--delay`: a `1000` (defaut), 1 tick = 1 seconde reelle; a `0`, la simulation tourne a fond sans pause.

Tu suis donc l'avancement en live avec un seul ecran qui se met a jour:

- progression temporelle
- shells
- shells/message
- nombre de messages
- nombre d'achats
- liste des upgrades avec niveau et bonus

## Lancer la simulation

Depuis la racine du projet:

```bash
npx tsx scripts/simulate-idle.ts
```

## Options

Toutes les options sont facultatives:

- `--steps=<n>`: nombre de ticks a simuler (defaut: `600`)
- `--delay=<ms>`: delai en millisecondes entre chaque tick (defaut: `1000`; `0` pour tourner sans pause)
- `--mps=<n>`: messages par seconde (defaut: `1`)
- `--start-shells=<n>`: capital initial en shells (defaut: `0`)
- `--strategy=<mode>`: strategie d'achat auto (defaut: `cheapest`)

Valeurs de `--strategy`:

- `cheapest`: achete toujours l'upgrade abordable la moins chere
- `best-payback`: achete l'upgrade abordable avec le meilleur payback (messages necessaires pour amortir)

Exemple:

```bash
npx tsx scripts/simulate-idle.ts --steps=900 --delay=500 --mps=1.5 --start-shells=5000 --strategy=best-payback
```

## Notes

- Le script n'inclut pas les effets runtime lies aux events Discord (cooldown, heat, streak, reactions, passive income).
- Il est fait pour etudier rapidement la courbe de progression et l'impact des upgrades.
