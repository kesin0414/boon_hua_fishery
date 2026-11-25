import { findCatalogEntry } from './SeafoodCatalog';

export const SEAFOOD_CATEGORY_OPTIONS = [
  { value: 'Fish', label: 'Fish', emoji: '🐟' },
  { value: 'Shellfish', label: 'Shellfish', emoji: '🐚' },
  { value: 'Prawn', label: 'Prawn & shrimp', emoji: '🦐' },
  { value: 'Crab', label: 'Crab', emoji: '🦀' },
  { value: 'Squid', label: 'Squid & octopus', emoji: '🦑' },
];

const VALID_CATEGORIES = new Set(SEAFOOD_CATEGORY_OPTIONS.map((o) => o.value));

export function isValidSeafoodCategory(value) {
  return VALID_CATEGORIES.has(value);
}

export function categoryFromIconKey(iconKey) {
  switch (iconKey) {
    case 'shellfish':
      return 'Shellfish';
    case 'prawn':
      return 'Prawn';
    case 'crab':
      return 'Crab';
    case 'squid':
      return 'Squid';
    default:
      return 'Fish';
  }
}

export function resolveSeafoodCategory(species, existingCategory) {
  if (existingCategory && isValidSeafoodCategory(existingCategory)) {
    return existingCategory;
  }
  const entry = findCatalogEntry(species);
  if (entry?.iconKey) {
    return categoryFromIconKey(entry.iconKey);
  }
  return 'Fish';
}

export function categoryBadgeClass(category) {
  switch (category) {
    case 'Shellfish':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Prawn':
      return 'bg-orange-50 text-orange-800 border-orange-200';
    case 'Crab':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'Squid':
      return 'bg-violet-50 text-violet-800 border-violet-200';
    case 'Fish':
    default:
      return 'bg-sky-50 text-sky-800 border-sky-200';
  }
}

export function categoryEmoji(category) {
  return SEAFOOD_CATEGORY_OPTIONS.find((o) => o.value === category)?.emoji ?? '🐟';
}
