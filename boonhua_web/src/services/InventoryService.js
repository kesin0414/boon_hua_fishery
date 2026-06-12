import { db } from '../firebase';
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { formatLocalDate } from '../utils/dateUtils';
import {
  formatSpeciesLabel,
  normalizeSpeciesName,
  findInventoryMatches,
  stockStatusForWeight,
} from '../domain/InventorySpecies';
import { MOVEMENT_OUT_TYPES } from '../domain/InventoryMovement';

export class InventoryService {
  async deductStock(inventory, species, quantityKg) {
    const matches = findInventoryMatches(inventory, species)
      .filter((item) => parseFloat(item.weight || 0) > 0)
      .sort((a, b) => parseFloat(b.weight || 0) - parseFloat(a.weight || 0));

    let remaining = quantityKg;
    for (const item of matches) {
      if (remaining <= 0) break;
      const current = parseFloat(item.weight || 0);
      const deduct = Math.min(current, remaining);
      const nextWeight = Number((current - deduct).toFixed(1));
      remaining = Number((remaining - deduct).toFixed(3));
      await updateDoc(doc(db, 'inventory', item.id), {
        weight: nextWeight,
        status: stockStatusForWeight(nextWeight),
        updatedAt: serverTimestamp(),
      });
    }

    if (remaining > 0.0001) {
      throw new Error(
        `Could not deduct full quantity. ${remaining.toFixed(1)} kg still unallocated in inventory.`,
      );
    }
  }

  async restoreStock(inventory, species, quantityKg, pricePerKg = null) {
    const label = formatSpeciesLabel(species);
    const matches = findInventoryMatches(inventory, species);
    const addQty = parseFloat(quantityKg) || 0;
    if (addQty <= 0) return;

    if (matches.length === 0) {
      const price = pricePerKg != null && !Number.isNaN(pricePerKg) ? pricePerKg : 0;
      await addDoc(collection(db, 'inventory'), {
        species: label,
        weight: Number(addQty.toFixed(1)),
        price,
        status: stockStatusForWeight(addQty),
        createdAt: serverTimestamp(),
      });
      return;
    }

    const item = [...matches].sort(
      (a, b) => parseFloat(b.weight || 0) - parseFloat(a.weight || 0),
    )[0];
    const current = parseFloat(item.weight || 0);
    const nextWeight = Number((current + addQty).toFixed(1));
    const patch = {
      species: label,
      weight: nextWeight,
      status: stockStatusForWeight(nextWeight),
      updatedAt: serverTimestamp(),
    };
    if (pricePerKg != null && !Number.isNaN(pricePerKg)) {
      patch.price = pricePerKg;
    }
    await updateDoc(doc(db, 'inventory', item.id), patch);
  }

  async updateItemPrice(itemId, newPrice) {
    await updateDoc(doc(db, 'inventory', itemId), { price: newPrice });
  }

  async recordHistory(entry) {
    const quantityKg = Math.abs(parseFloat(entry.quantityKg) || 0);
    const direction = entry.direction || (MOVEMENT_OUT_TYPES.has(entry.type) ? 'out' : 'in');
    const quantityDelta = direction === 'in' ? quantityKg : -quantityKg;
    await addDoc(collection(db, 'inventoryHistory'), {
      movementDate: entry.movementDate || formatLocalDate(new Date()),
      type: entry.type,
      direction,
      quantityDelta,
      species: formatSpeciesLabel(entry.species),
      quantityKg: Number(quantityKg.toFixed(2)),
      pricePerKg: entry.pricePerKg ?? null,
      totalAmountRm: entry.totalAmountRm ?? null,
      inputMode: entry.inputMode || 'weight',
      note: entry.note || '',
      reference: entry.reference || null,
      orderId: entry.orderId || null,
      inventoryId: entry.inventoryId || null,
      createdAt: serverTimestamp(),
    });
  }

  async recordEditHistory(itemId, before, after) {
    const species = formatSpeciesLabel(after.species);
    const price = parseFloat(after.price) || 0;
    const prevWeight = parseFloat(before.weight) || 0;
    const newWeight = parseFloat(after.weight) || 0;
    const delta = Number((newWeight - prevWeight).toFixed(2));
    const ref = `INV-${String(itemId).slice(0, 8)}`;

    if (Math.abs(delta) > 0.0001) {
      await this.recordHistory({
        type: 'adjustment',
        direction: delta > 0 ? 'in' : 'out',
        species,
        quantityKg: Math.abs(delta),
        pricePerKg: price,
        totalAmountRm: Number((Math.abs(delta) * price).toFixed(2)),
        inventoryId: itemId,
        reference: ref,
        note:
          delta > 0
            ? `Admin edit: added ${Math.abs(delta).toFixed(1)} kg (${prevWeight.toFixed(1)} → ${newWeight.toFixed(1)} kg)`
            : `Admin edit: removed ${Math.abs(delta).toFixed(1)} kg (${prevWeight.toFixed(1)} → ${newWeight.toFixed(1)} kg)`,
      });
    }

    if ((before.status || '') !== (after.status || '')) {
      await this.recordHistory({
        type: 'status_change',
        direction: 'in',
        species,
        quantityKg: 0,
        pricePerKg: price,
        inventoryId: itemId,
        reference: ref,
        note: `Admin edit: status “${before.status || '—'}” → “${after.status || '—'}”`,
      });
    }

    if (normalizeSpeciesName(before.species) !== normalizeSpeciesName(after.species)) {
      await this.recordHistory({
        type: 'adjustment',
        direction: 'in',
        species,
        quantityKg: 0,
        inventoryId: itemId,
        reference: ref,
        note: `Admin edit: species renamed “${before.species}” → “${after.species}”`,
      });
    }

    const prevPrice = parseFloat(before.price);
    if (!Number.isNaN(prevPrice) && prevPrice !== price) {
      await this.recordHistory({
        type: 'price_change',
        direction: 'in',
        species,
        quantityKg: 0,
        pricePerKg: price,
        inventoryId: itemId,
        reference: ref,
        note: `Admin edit: price RM ${prevPrice.toFixed(2)}/kg → RM ${price.toFixed(2)}/kg`,
      });
    }
  }

  async patchSaleHistory(orderId, patch) {
    if (!orderId) return;
    const snap = await getDocs(
      query(collection(db, 'inventoryHistory'), where('orderId', '==', orderId)),
    );
    const updates = [];
    snap.forEach((docSnap) => {
      if (docSnap.data().type === 'sale') {
        updates.push(updateDoc(docSnap.ref, patch));
      }
    });
    await Promise.all(updates);
  }

  async adjustStockForSaleCorrection(inventory, oldSpecies, oldQty, newSpecies, newQty) {
    const sameSpecies =
      normalizeSpeciesName(oldSpecies) === normalizeSpeciesName(newSpecies);

    if (sameSpecies) {
      const delta = Number((newQty - oldQty).toFixed(2));
      if (Math.abs(delta) < 0.0001) return;
      if (delta > 0) {
        await this.deductStock(inventory, newSpecies, delta);
      } else {
        await this.restoreStock(inventory, newSpecies, Math.abs(delta), null);
      }
      return;
    }

    if (oldQty > 0.0001) {
      await this.restoreStock(inventory, oldSpecies, oldQty, null);
    }
    if (newQty > 0.0001) {
      await this.deductStock(inventory, newSpecies, newQty);
    }
  }
}

export const inventoryService = new InventoryService();

export const deductInventoryStock = (...args) => inventoryService.deductStock(...args);
export const restoreInventoryStock = (...args) => inventoryService.restoreStock(...args);
export const recordInventoryHistory = (...args) => inventoryService.recordHistory(...args);
export const recordInventoryEditHistory = (...args) => inventoryService.recordEditHistory(...args);
export const patchSaleInventoryHistory = (...args) => inventoryService.patchSaleHistory(...args);
export const adjustStockForSaleCorrection = (...args) =>
  inventoryService.adjustStockForSaleCorrection(...args);
