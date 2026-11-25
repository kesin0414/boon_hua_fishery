/**
 * Sales report export — generated in the browser (CSV, Excel, PDF via print).
 */

import * as XLSX from 'xlsx';

function safeFilenamePart(value) {
  return String(value || 'report').replace(/[^\w.-]+/g, '_');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function exportCsvClient(payload, filename) {
  const { summary } = payload;
  const lines = [
    `Store,${escapeCsvCell(payload.storeName)}`,
    `Period,${escapeCsvCell(payload.periodLabel)}`,
    `From,${escapeCsvCell(payload.dateFrom)}`,
    `To,${escapeCsvCell(payload.dateTo)}`,
    `Generated,${escapeCsvCell(payload.generatedAt)}`,
    '',
    'Summary',
    `Total sales (RM),${formatMoney(summary.totalSales)}`,
    `Collected (RM),${formatMoney(summary.collected)}`,
    `Outstanding (RM),${formatMoney(summary.owing)}`,
    `Paid bills,${summary.paidCount}`,
    `Unpaid bills,${summary.unpaidCount}`,
    `Total sales count,${summary.count}`,
    '',
    'Buyers',
    'Buyer,Type,Bills,Total (RM),Paid (RM),Owing (RM)',
    ...payload.buyerSummary.map((row) => [
      escapeCsvCell(row.name),
      escapeCsvCell(row.buyerTypeLabel || row.buyerType || ''),
      row.bills,
      formatMoney(row.total),
      formatMoney(row.paid),
      formatMoney(row.owing),
    ].join(',')),
    '',
    'Sales ledger',
    'Ref,Date,Buyer,Phone,Item,Qty (kg),Total (RM),Paid (RM),Owing (RM),Status',
    ...payload.ledgerRows.map((row) => [
      escapeCsvCell(row.ref),
      escapeCsvCell(row.date),
      escapeCsvCell(row.buyer),
      escapeCsvCell(row.phone),
      escapeCsvCell(row.item),
      row.qtyKg,
      formatMoney(row.total),
      formatMoney(row.paid),
      formatMoney(row.owing),
      escapeCsvCell(row.status),
    ].join(',')),
  ];

  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  triggerDownload(blob, filename);
}

function exportXlsxClient(payload, filename) {
  const { summary } = payload;
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Store', payload.storeName],
    ['Period', payload.periodLabel],
    ['From', payload.dateFrom],
    ['To', payload.dateTo],
    ['Generated', payload.generatedAt],
    [],
    ['Metric', 'Value'],
    ['Total sales (RM)', summary.totalSales],
    ['Collected (RM)', summary.collected],
    ['Outstanding (RM)', summary.owing],
    ['Paid bills', summary.paidCount],
    ['Unpaid bills', summary.unpaidCount],
    ['Sales count', summary.count],
  ]);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

  const buyersSheet = XLSX.utils.aoa_to_sheet([
    ['Buyer', 'Type', 'Bills', 'Total (RM)', 'Paid (RM)', 'Owing (RM)'],
    ...payload.buyerSummary.map((row) => [
      row.name,
      row.buyerTypeLabel || row.buyerType || '',
      row.bills,
      row.total,
      row.paid,
      row.owing,
    ]),
  ]);
  XLSX.utils.book_append_sheet(wb, buyersSheet, 'Buyers');

  const ledgerSheet = XLSX.utils.aoa_to_sheet([
    ['Ref', 'Date', 'Buyer', 'Phone', 'Item', 'Qty (kg)', 'Total (RM)', 'Paid (RM)', 'Owing (RM)', 'Status'],
    ...payload.ledgerRows.map((row) => [
      row.ref,
      row.date,
      row.buyer,
      row.phone,
      row.item,
      row.qtyKg,
      row.total,
      row.paid,
      row.owing,
      row.status,
    ]),
  ]);
  XLSX.utils.book_append_sheet(wb, ledgerSheet, 'Sales ledger');

  XLSX.writeFile(wb, filename);
}

function buildReportPrintHtml(payload) {
  const { summary } = payload;
  const buyerRows = payload.buyerSummary.map((row) => `
    <tr>
      <td>${row.name}</td>
      <td>${row.buyerTypeLabel || row.buyerType || '—'}</td>
      <td class="num">${row.bills}</td>
      <td class="num">RM ${formatMoney(row.total)}</td>
      <td class="num">RM ${formatMoney(row.paid)}</td>
      <td class="num">RM ${formatMoney(row.owing)}</td>
    </tr>
  `).join('');

  const ledgerRows = payload.ledgerRows.map((row) => `
    <tr>
      <td>${row.ref}</td>
      <td>${row.date}</td>
      <td>${row.buyer}</td>
      <td>${row.item}</td>
      <td class="num">${row.qtyKg}</td>
      <td class="num">RM ${formatMoney(row.total)}</td>
      <td class="num">RM ${formatMoney(row.paid)}</td>
      <td class="num">RM ${formatMoney(row.owing)}</td>
      <td>${row.status}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${payload.storeName} — Sales Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 24px 0 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    .meta { color: #64748b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
    th { background: #f8fafc; font-size: 11px; text-transform: uppercase; }
    .num { text-align: right; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 16px 0; }
    .summary div { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
    .summary strong { display: block; font-size: 16px; margin-top: 4px; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <h1>${payload.storeName}</h1>
  <p class="meta">Monthly sales &amp; collection report · ${payload.periodLabel}</p>
  <p class="meta">Period: ${payload.dateFrom} — ${payload.dateTo} · Generated: ${payload.generatedAt}</p>
  <div class="summary">
    <div>Total sales<strong>RM ${formatMoney(summary.totalSales)}</strong></div>
    <div>Collected<strong>RM ${formatMoney(summary.collected)}</strong></div>
    <div>Outstanding<strong>RM ${formatMoney(summary.owing)}</strong></div>
  </div>
  <h2>By buyer</h2>
  <table>
    <thead><tr><th>Buyer</th><th>Type</th><th>Bills</th><th>Total</th><th>Paid</th><th>Owing</th></tr></thead>
    <tbody>${buyerRows}</tbody>
  </table>
  <h2>Sales ledger</h2>
  <table>
    <thead><tr><th>Ref</th><th>Date</th><th>Buyer</th><th>Item</th><th>Qty</th><th>Total</th><th>Paid</th><th>Owing</th><th>Status</th></tr></thead>
    <tbody>${ledgerRows}</tbody>
  </table>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

function exportPdfClient(payload) {
  const html = buildReportPrintHtml(payload);
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Pop-up blocked. Allow pop-ups for this site to export PDF.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * Export sales report (CSV / Excel download, PDF opens print dialog to save as PDF).
 * @param {object} payload — from buildSalesReportPayload()
 * @param {'csv'|'xlsx'|'pdf'} format
 */
export async function exportSalesReport(payload, format) {
  if (!payload?.ledgerRows?.length) {
    throw new Error('No sales in the selected period to export.');
  }

  const stamp = safeFilenamePart(`${payload.dateFrom}_${payload.dateTo}`);
  const baseName = `boonhua_sales_report_${stamp}`;

  if (format === 'csv') {
    exportCsvClient(payload, `${baseName}.csv`);
    return;
  }
  if (format === 'xlsx') {
    exportXlsxClient(payload, `${baseName}.xlsx`);
    return;
  }
  if (format === 'pdf') {
    exportPdfClient(payload);
    return;
  }
  throw new Error(`Unsupported export format: ${format}`);
}

/** Build normalized export payload from report page state. */
export function buildSalesReportPayload({
  storeInfo,
  dateFrom,
  dateTo,
  periodLabel,
  summary,
  buyerSummary,
  periodOrders,
  getBuyerTypeLabel,
  getOrderDateKey,
  getOrderTotal,
  getOrderAmountPaid,
  getOrderAmountOwing,
  paymentStatusReportLabel,
}) {
  const ledgerRows = periodOrders.map((order) => {
    const total = getOrderTotal(order);
    const paid = getOrderAmountPaid(order);
    const due = getOrderAmountOwing(order);
    return {
      ref: order.saleRef || '—',
      date: order.saleDate || getOrderDateKey(order) || '—',
      buyer: order.buyerName || '—',
      phone: order.buyerPhone || '—',
      item: order.species || '—',
      qtyKg: order.quantityKg ?? '—',
      total,
      paid,
      owing: due > 0.009 ? due : 0,
      status: paymentStatusReportLabel(order),
    };
  });

  return {
    storeName: storeInfo?.storeName || 'Boon Hua Fishery',
    dateFrom,
    dateTo,
    periodLabel,
    generatedAt: new Date().toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }),
    summary,
    buyerSummary: buyerSummary.map((row) => ({
      ...row,
      buyerTypeLabel: getBuyerTypeLabel(row.buyerType),
    })),
    ledgerRows,
  };
}
