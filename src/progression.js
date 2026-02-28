const STORAGE_KEY = 'voxel-progress';

let progress = {
  level: 1,
  xp: 0,
  totalKills: 0,
  totalScore: 0,
  highScore: 0,
  gamesPlayed: 0,
  highestWave: 0,
};

function xpToNext(level) {
  return Math.floor(100 * level * 1.5);
}

export function initProgression() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      progress = { ...progress, ...parsed };
    }
  } catch (e) {
    console.warn('Could not load progress:', e);
  }
}

export function getProgress() {
  return {
    level: progress.level,
    xp: progress.xp,
    xpToNext: xpToNext(progress.level),
    totalKills: progress.totalKills,
    totalScore: progress.totalScore,
    highScore: progress.highScore,
    gamesPlayed: progress.gamesPlayed,
    highestWave: progress.highestWave,
  };
}

export function getLevel() {
  return progress.level;
}

export function addXP(amount) {
  progress.xp += amount;
  let needed = xpToNext(progress.level);
  while (progress.xp >= needed) {
    progress.xp -= needed;
    progress.level++;
    needed = xpToNext(progress.level);
  }
  saveProgress();
}

export function getTitle() {
  if (progress.level >= 15) return 'Elite';
  if (progress.level >= 5) return 'Veteran';
  return '';
}

export function getCrosshairColor() {
  if (progress.level >= 20) return '#ff3344';
  if (progress.level >= 10) return '#ffd700';
  if (progress.level >= 2) return '#0ff';
  return 'rgba(255,255,255,0.4)';
}

export function recordGame(score, kills, wave) {
  progress.totalScore += score;
  progress.totalKills += kills;
  progress.gamesPlayed++;
  if (score > progress.highScore) progress.highScore = score;
  if (wave > progress.highestWave) progress.highestWave = wave;
  const xpGained = kills + Math.floor(score / 10) + wave * 5;
  addXP(xpGained);
}

export function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch (e) {
    console.warn('Could not save progress:', e);
  }
}
