/**
 * TapMe Phase 7 — System Management, Health & Diagnostics Utilities
 */

/**
 * Formats a UTC timestamp into Indian Standard Time (Asia/Kolkata, UTC+05:30).
 *
 * @param {string|null|undefined} timestamp
 * @returns {string}
 */
export function formatSystemDateTime(timestamp) {
  if (!timestamp) return '—';

  try {
    const trimmed = String(timestamp).trim();
    if (!trimmed) return '—';

    let dateToParse = trimmed;
    const hasTzOffset =
      /Z$/i.test(trimmed) || /[+-]\d{2}(?::?\d{2})?$/.test(trimmed);

    if (!hasTzOffset) {
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) {
        dateToParse = `${trimmed.replace(' ', 'T')}Z`;
      } else {
        dateToParse = `${trimmed}Z`;
      }
    }

    const d = new Date(dateToParse);
    if (isNaN(d.getTime())) {
      return trimmed;
    }

    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return String(timestamp);
  }
}

/**
 * Returns badge styling and human label for system operational status.
 *
 * @param {string} status
 * @returns {{ label: string; badgeClass: string; dotClass: string }}
 */
export function getStatusBadge(status) {
  switch (status?.toLowerCase()) {
    case 'operational':
      return {
        label: 'Operational',
        badgeClass: 'status-pill-operational',
        dotClass: 'bg-emerald-400',
      };
    case 'degraded':
      return {
        label: 'Degraded',
        badgeClass: 'status-pill-degraded',
        dotClass: 'bg-amber-400',
      };
    case 'unavailable':
      return {
        label: 'Unavailable',
        badgeClass: 'status-pill-unavailable',
        dotClass: 'bg-rose-500',
      };
    default:
      return {
        label: 'Unknown',
        badgeClass: 'status-pill-unknown',
        dotClass: 'bg-slate-400',
      };
  }
}

/**
 * Returns badge styling and human label for diagnostic event severity.
 *
 * @param {string} severity
 * @returns {{ label: string; badgeClass: string }}
 */
export function getSeverityBadge(severity) {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return { label: 'CRITICAL', badgeClass: 'severity-badge-critical' };
    case 'error':
      return { label: 'ERROR', badgeClass: 'severity-badge-error' };
    case 'warning':
      return { label: 'WARNING', badgeClass: 'severity-badge-warning' };
    case 'info':
    default:
      return { label: 'INFO', badgeClass: 'severity-badge-info' };
  }
}

/**
 * Initiates browser file download from a Blob or string content.
 *
 * @param {Blob|string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Opens a print-formatted HTML document for generating Audit Report PDFs.
 * Includes report title, Asia/Kolkata date/time, record counts, table layout,
 * and page numbers formatted with @page CSS.
 *
 * @param {Array<Object>} logs
 * @param {{ cutoff?: string; startDate?: string; endDate?: string }} filter
 */
export function generateAuditPdfReport(logs = [], filter = {}) {
  const generatedAtIst = formatSystemDateTime(new Date().toISOString());
  const rowsHtml = logs
    .map(
      (log, idx) => `
    <tr>
      <td style="font-family: monospace; font-size: 11px;">${idx + 1}</td>
      <td style="font-family: monospace; font-size: 11px; white-space: nowrap;">${formatSystemDateTime(log.created_at_utc || log.created_at)}</td>
      <td style="font-weight: 600;">${escapeHtml(log.action || '—')}</td>
      <td>${escapeHtml(log.actor_username || 'System')}</td>
      <td><span style="font-family: monospace; font-size: 11px;">${escapeHtml(log.entity_type || '—')}${log.entity_id ? ` #${escapeHtml(String(log.entity_id))}` : ''}</span></td>
      <td style="font-family: monospace; font-size: 10px; max-width: 320px; word-break: break-all;">${escapeHtml(typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '—'))}</td>
    </tr>
  `
    )
    .join('');

  const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>TapMe Audit History — Print / Save PDF View</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 15mm 12mm 15mm 12mm;
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 9px;
        color: #64748b;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 12px;
      color: #0f172a;
      line-height: 1.4;
      margin: 0;
      padding: 0;
    }
    .header {
      border-bottom: 2px solid #6366f1;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .brand {
      font-size: 20px;
      font-weight: 800;
      color: #4f46e5;
      letter-spacing: -0.5px;
    }
    .report-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      margin-top: 2px;
    }
    .meta-box {
      text-align: right;
      font-size: 11px;
      color: #475569;
    }
    .meta-row {
      margin-bottom: 2px;
    }
    .meta-val {
      font-weight: 600;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 11px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid #cbd5e1;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.5px;
    }
    td {
      padding: 6px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tr:nth-child(even) td {
      background-color: #f8fafc;
    }
    .footer {
      margin-top: 24px;
      font-size: 10px;
      color: #94a3b8;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
    }
    @media print {
      .no-print { display: none; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">TapMe Platform</div>
      <div class="report-title">Audit History — Print / Save PDF View</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">(Primary structured export is available via CSV for Excel & Google Sheets)</div>
    </div>
    <div class="meta-box">
      <div class="meta-row">Generated: <span class="meta-val">${generatedAtIst} (IST)</span></div>
      <div class="meta-row">Covered Records: <span class="meta-val">${logs.length}</span></div>
      ${filter.cutoff ? `<div class="meta-row">Cutoff: <span class="meta-val">${escapeHtml(filter.cutoff)}</span></div>` : ''}
    </div>
  </div>

  <div class="no-print" style="margin-bottom: 14px; background: #e0e7ff; padding: 10px 14px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
    <span style="font-size: 12px; color: #3730a3; font-weight: 500;">Browser Print View: Press <strong>Ctrl + P</strong> (or <strong>Cmd + P</strong>) to Save as PDF with page numbers.</span>
    <button onclick="window.print()" style="background: #4f46e5; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-weight: 600; cursor: pointer;">Print / Save as PDF</button>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 28px;">#</th>
        <th style="width: 140px;">Timestamp (IST)</th>
        <th style="width: 110px;">Action</th>
        <th style="width: 90px;">Actor</th>
        <th style="width: 90px;">Entity</th>
        <th>Event Details (Sanitized)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    TapMe Secure Smart Card Platform • Append-Only Audit Integrity System • Confidential Business Record
  </div>
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(reportHtml);
    printWindow.document.close();
    printWindow.focus();
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

