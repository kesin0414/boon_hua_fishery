export class InventorySpecies {
  /** Above this weight (kg) = In Stock; 1–threshold = Low Stock; 0 = Out of Stock */
  static LOW_STOCK_THRESHOLD_KG = 20;

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
  /**
   * Landing / farm-gate cost (RM/kg) paid when buying catch.
   * Separate from daily market/selling `price` shown on mobile Market.
   * Returns null when not recorded (legacy rows).
   */
  static landingPriceOf(item) {
    if (!item) return null;
    const raw = item.landingPrice ?? item.farmGatePrice ?? item.costPrice;
    if (raw === '' || raw == null) return null;
    const value = parseFloat(raw);
    if (Number.isNaN(value) || value < 0) return null;
    return value;
  }

  static consolidateInventoryBySpecies(inventory) {
    const merged = new Map();
    inventory.forEach((item) => {
      const key = InventorySpecies.normalizeSpeciesName(item.species);
      if (!key) return;
      const weight = parseFloat(item.weight || 0);
      const price = parseFloat(item.price ?? 0);
      const landingPrice = InventorySpecies.landingPriceOf(item);
      if (merged.has(key)) {
        const current = merged.get(key);
        current.weight = parseFloat(current.weight) + weight;
        current.price = price;
        if (landingPrice != null) current.landingPrice = landingPrice;
        current.sourceIds.push(item.id);
        if (item.category) current.category = item.category;
        if (weight > 0) current.primaryId = item.id;
      } else {
        merged.set(key, {
          id: item.id,
          primaryId: item.id,
          sourceIds: [item.id],
          species: InventorySpecies.formatSpeciesLabel(item.species),
          category: item.category || '',
          weight,
          price,
          landingPrice: landingPrice ?? null,
          status: item.status,
        });
      }
    });
    return [...merged.values()];
  }

  static stockStatusForWeight(weight) {
    const w = parseFloat(weight) || 0;
    if (w <= 0) return 'Out of Stock';
    if (w <= InventorySpecies.LOW_STOCK_THRESHOLD_KG) return 'Low Stock';
    return 'In Stock';
  }

  static isLowStockWeight(weight) {
    const w = parseFloat(weight) || 0;
    return w > 0 && w <= InventorySpecies.LOW_STOCK_THRESHOLD_KG;
  }
}

export const normalizeSpeciesName = InventorySpecies.normalizeSpeciesName;
export const formatSpeciesLabel = InventorySpecies.formatSpeciesLabel;
export const findInventoryMatches = InventorySpecies.findMatches;
export const consolidateInventoryBySpecies = InventorySpecies.consolidateInventoryBySpecies;
export const stockStatusForWeight = InventorySpecies.stockStatusForWeight;
export const LOW_STOCK_THRESHOLD_KG = InventorySpecies.LOW_STOCK_THRESHOLD_KG;
export const isLowStockWeight = InventorySpecies.isLowStockWeight;
export const landingPriceOf = InventorySpecies.landingPriceOf.bind(InventorySpecies);

export const STOCK_STATUS_OPTIONS = ['In Stock', 'Low Stock', 'Out of Stock'];

export function stockStatusFilterLabel(status) {
  switch (status) {
    case 'In Stock':
      return `In stock (>${LOW_STOCK_THRESHOLD_KG} kg)`;
    case 'Low Stock':
      return `Low stock (1–${LOW_STOCK_THRESHOLD_KG} kg)`;
    case 'Out of Stock':
      return 'Out of stock (0 kg)';
    default:
      return status;
  }
}
