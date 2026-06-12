export class InventorySpecies {
  static normalizeSpeciesName(name) {
    return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  static formatSpeciesLabel(name) {
    return (name || '').trim().replace(/\s+/g, ' ');
  }

  static findMatches(inventory, species) {
    const key = InventorySpecies.normalizeSpeciesName(species);
    return inventory.filter(
      (item) => InventorySpecies.normalizeSpeciesName(item.species) === key,
    );
  }

  /** One row per species (weights summed) for sales UI and stock checks. */
  static consolidateInventoryBySpecies(inventory) {
    const merged = new Map();
    inventory.forEach((item) => {
      const key = InventorySpecies.normalizeSpeciesName(item.species);
      if (!key) return;
      const weight = parseFloat(item.weight || 0);
      const price = parseFloat(item.price ?? 0);
      if (merged.has(key)) {
        const current = merged.get(key);
        current.weight = parseFloat(current.weight) + weight;
        current.price = price;
        current.sourceIds.push(item.id);
        if (weight > 0) current.primaryId = item.id;
      } else {
        merged.set(key, {
          id: item.id,
          primaryId: item.id,
          sourceIds: [item.id],
          species: InventorySpecies.formatSpeciesLabel(item.species),
          weight,
          price,
          status: item.status,
        });
      }
    });
    return [...merged.values()];
  }

  static stockStatusForWeight(weight) {
    if (weight <= 0) return 'Out of Stock';
    if (weight < 5) return 'Low Stock';
    return 'In Stock';
  }
}

export const normalizeSpeciesName = InventorySpecies.normalizeSpeciesName;
export const formatSpeciesLabel = InventorySpecies.formatSpeciesLabel;
export const findInventoryMatches = InventorySpecies.findMatches;
export const consolidateInventoryBySpecies = InventorySpecies.consolidateInventoryBySpecies;
export const stockStatusForWeight = InventorySpecies.stockStatusForWeight;
