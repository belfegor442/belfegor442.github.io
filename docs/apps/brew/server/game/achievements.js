export const ACHIEVEMENTS = [
  { id: 'first_pour', name: 'First Pour', description: 'Play your first BREW round.', test: (s) => s.rounds >= 1 },
  { id: 'sharp_stopper', name: 'Sharp Stopper', description: 'Land 25 perfect stops.', test: (s) => s.perfects >= 25 },
  { id: 'machine_gun', name: 'Machine Gun', description: 'Land 200 perfect stops.', test: (s) => s.perfects >= 200 },
  { id: 'combo_x4', name: 'Full Steam', description: 'Reach a x4 combo.', test: (s) => s.maxCombo >= 4 },
  { id: 'overbrewer', name: 'Overbrewer', description: 'Bank an Overbrew.', test: (s) => s.overbrewSuccess >= 1 },
  { id: 'reckless', name: 'Reckless Brewer', description: 'Blow 5 Overbrews.', test: (s) => s.overbrewFail >= 5 },
  { id: 'high_score_5k', name: 'Five Grand', description: 'Score 5,000 in one session.', test: (s) => s.bestScore >= 5000 },
  { id: 'high_score_20k', name: 'Bar Legend', description: 'Score 20,000 in one session.', test: (s) => s.bestScore >= 20000 },
  { id: 'pub_brawler', name: 'Pub Brawler', description: 'Land 20 sabotage hits.', test: (s) => s.sabotageHit >= 20 },
  { id: 'duelist', name: 'Duelist', description: 'Win 5 challenges.', test: (s) => s.challengesWon >= 5 },
  { id: 'night_owl', name: 'Night Owl', description: 'Play 25 sessions.', test: (s) => s.gamesPlayed >= 25 },
  { id: 'regular', name: 'The Regular', description: 'Walk 5km inside the bar.', test: (s) => s.distanceWalked >= 5000 },
];

export function evaluateAchievements(stats, alreadyUnlocked = []) {
  const unlocked = new Set(alreadyUnlocked);
  const gained = [];
  for (const achievement of ACHIEVEMENTS) {
    if (unlocked.has(achievement.id)) continue;
    if (achievement.test(stats)) {
      unlocked.add(achievement.id);
      gained.push(achievement);
    }
  }
  return { unlocked: [...unlocked], gained };
}

export function xpForLevel(level) {
  return Math.round(120 * Math.pow(level, 1.5));
}

export function applyProgression(progression, gainedXp) {
  const next = { ...progression, xp: progression.xp + gainedXp };
  while (next.xp >= xpForLevel(next.level)) {
    next.xp -= xpForLevel(next.level);
    next.level += 1;
  }
  return next;
}
