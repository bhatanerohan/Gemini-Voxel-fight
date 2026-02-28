const STORAGE_KEY = 'voxel-weapons';

export function saveWeapons(slots) {
  try {
    const data = slots.map((slot, i) => {
      if (!slot || !slot.fn) return null;
      return { prompt: slot.name || '', code: slot.code || '', slotIndex: i };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save weapons:', e);
  }
}

export function loadWeapons() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.warn('Failed to load weapons (corrupted data?):', e);
    return [];
  }
}

export function clearWeapons() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear weapons:', e);
  }
}
