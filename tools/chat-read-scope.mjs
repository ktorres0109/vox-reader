// Chat reply scope filter (unit-tested)

/**
 * @param {unknown[]} roots
 * @param {'all'|'latest'|'single'} scope
 * @param {number} index
 */
export function filterChatRoots(roots, scope, index = 0) {
  if (!roots?.length) return roots || [];
  if (scope === 'latest') return [roots[roots.length - 1]];
  if (scope === 'single') {
    const i = Math.min(Math.max(0, index), roots.length - 1);
    return [roots[i]];
  }
  return roots;
}

export function normalizeChatReadScope(value) {
  return value === 'latest' || value === 'single' ? value : 'all';
}
