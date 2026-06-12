export const MOVEMENT_OUT_TYPES = new Set([
  'sale',
  'spoiled',
  'wastage',
  'damaged',
  'expired',
  'other',
  'inventory_delete',
]);

export const STOCK_REMOVAL_REASONS = [
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'wastage', label: 'Wastage / trim loss' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other loss' },
];

export class InventoryMovement {
  static direction(row) {
    if (row.direction === 'in' || row.direction === 'out') return row.direction;
    if (typeof row.quantityDelta === 'number') {
      return row.quantityDelta >= 0 ? 'in' : 'out';
    }
    return MOVEMENT_OUT_TYPES.has(row.type) ? 'out' : 'in';
  }

  static inOutKg(row) {
    const qty = Math.abs(parseFloat(row.quantityKg) || 0);
    return InventoryMovement.direction(row) === 'in'
      ? { stockIn: qty, stockOut: 0 }
      : { stockIn: 0, stockOut: qty };
  }

  static formatDateTime(row) {
    const created = row.createdAt?.toDate?.();
    if (created) {
      return created.toLocaleString('en-MY', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return row.movementDate || '—';
  }

  static typeLabel(type) {
    const map = {
      sale: 'Sale',
      sale_void: 'Sale deleted (reversal)',
      inventory_delete: 'Inventory record deleted',
      spoiled: 'Spoiled',
      wastage: 'Wastage',
      damaged: 'Damaged',
      expired: 'Expired',
      other: 'Other loss',
      restock: 'Restock',
      adjustment: 'Stock adjustment (admin edit)',
      status_change: 'Status updated (admin edit)',
      price_change: 'Price updated (admin edit)',
    };
    return map[type] || type || '—';
  }

  static badgeClass(type) {
    if (type === 'sale') return 'bg-emerald-100 text-emerald-800';
    if (type === 'sale_void') return 'bg-violet-100 text-violet-800';
    if (type === 'inventory_delete') return 'bg-slate-200 text-slate-800';
    if (type === 'restock') return 'bg-blue-100 text-blue-800';
    if (type === 'adjustment') return 'bg-indigo-100 text-indigo-800';
    if (type === 'status_change' || type === 'price_change') return 'bg-slate-100 text-slate-700';
    return 'bg-orange-100 text-orange-800';
  }
}

export const movementDirection = InventoryMovement.direction;
export const movementInOutKg = InventoryMovement.inOutKg;
export const formatMovementDateTime = InventoryMovement.formatDateTime;
export const movementTypeLabel = InventoryMovement.typeLabel;
export const movementTypeBadgeClass = InventoryMovement.badgeClass;
