import type { RowDataPacket } from 'mysql2/promise';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { getMysqlPool } from './mysql.js';
import { selectOne, withConnection } from './mysqlUtils.js';
import type { InvoiceDetail } from '../modules/domain/types.js';

type InvoicePdfTemplateRow = RowDataPacket & {
  bottomMargin: number | null;
  leftMargin: number | null;
  name: string | null;
  pdfContent: Buffer | null;
  rightMargin: number | null;
  topMargin: number | null;
};

type PdfCanvas = {
  boldFont: PDFFont;
  font: PDFFont;
  page: PDFPage;
  width: number;
  x: number;
  y: number;
};

const DEFAULT_MARGINS = {
  bottom: 72,
  left: 54,
  right: 54,
  top: 120,
};

const formatMoney = (amount: number, currencyCode: string) => {
  const normalizedCurrency = /^[A-Z]{3}$/.test(String(currencyCode || '').trim().toUpperCase())
    ? String(currencyCode || '').trim().toUpperCase()
    : 'USD';
  const formattedAmount = Number(amount || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  return `${normalizedCurrency} ${formattedAmount}`;
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));

const safeText = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number) => {
  const paragraphs = String(text || '')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const lines: string[] = [];

  for (const paragraph of paragraphs.length ? paragraphs : ['']) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }

    if (line) {
      lines.push(line);
    }
  }

  return lines.length ? lines : [''];
};

const drawWrapped = (
  canvas: PdfCanvas,
  text: string,
  options: { color?: ReturnType<typeof rgb>; font?: PDFFont; lineGap?: number; maxLines?: number; size?: number } = {}
) => {
  const size = options.size ?? 9;
  const font = options.font ?? canvas.font;
  const color = options.color ?? rgb(0.17, 0.21, 0.28);
  const lineHeight = size + (options.lineGap ?? 4);
  const lines = wrapText(text, font, size, canvas.width);
  const visibleLines = options.maxLines ? lines.slice(0, options.maxLines) : lines;

  for (const line of visibleLines) {
    canvas.page.drawText(line, {
      color,
      font,
      size,
      x: canvas.x,
      y: canvas.y,
    });
    canvas.y -= lineHeight;
  }

  return canvas.y;
};

const drawLabelValue = (canvas: PdfCanvas, label: string, value: string) => {
  const labelWidth = Math.min(150, canvas.width * 0.34);
  canvas.page.drawText(label, {
    color: rgb(0.42, 0.45, 0.5),
    font: canvas.font,
    size: 8.5,
    x: canvas.x,
    y: canvas.y,
  });
  canvas.page.drawText(value, {
    color: rgb(0.07, 0.09, 0.15),
    font: canvas.boldFont,
    size: 8.5,
    x: canvas.x + labelWidth,
    y: canvas.y,
  });
  canvas.y -= 14;
};

const loadInvoicePdfTemplate = async (invoiceId: string) =>
  withConnection(getMysqlPool(), async (connection) =>
    selectOne<InvoicePdfTemplateRow>(
      connection,
      `SELECT
         COALESCE(snap.pdf_content, active.pdf_content) AS pdfContent,
         COALESCE(i.pdf_template_name_snapshot, snap.name, active.name) AS name,
         COALESCE(i.pdf_content_top_margin_snapshot, snap.content_top_margin, active.content_top_margin) AS topMargin,
         COALESCE(i.pdf_content_left_margin_snapshot, snap.content_left_margin, active.content_left_margin) AS leftMargin,
         COALESCE(i.pdf_content_right_margin_snapshot, snap.content_right_margin, active.content_right_margin) AS rightMargin,
         COALESCE(i.pdf_content_bottom_margin_snapshot, snap.content_bottom_margin, active.content_bottom_margin) AS bottomMargin
       FROM invoices i
       LEFT JOIN invoice_pdf_templates snap
         ON snap.public_id = i.pdf_template_public_id_snapshot
       LEFT JOIN invoice_pdf_templates active
         ON active.is_active = 1
        AND active.archived_at IS NULL
       WHERE i.public_id = ?
       LIMIT 1`,
      [invoiceId]
    )
  );

export const renderInvoicePdfFromTemplate = async (
  invoice: InvoiceDetail,
  template?: Partial<InvoicePdfTemplateRow> | null
) => {
  const pdfDoc = template?.pdfContent
    ? await PDFDocument.load(template.pdfContent)
    : await PDFDocument.create();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.getPageCount() > 0 ? pdfDoc.getPage(0) : pdfDoc.addPage([595.28, 841.89]);
  const { height, width } = page.getSize();
  const margins = {
    bottom: Number(template?.bottomMargin ?? DEFAULT_MARGINS.bottom),
    left: Number(template?.leftMargin ?? DEFAULT_MARGINS.left),
    right: Number(template?.rightMargin ?? DEFAULT_MARGINS.right),
    top: Number(template?.topMargin ?? DEFAULT_MARGINS.top),
  };
  const canvas: PdfCanvas = {
    boldFont,
    font,
    page,
    width: Math.max(180, width - margins.left - margins.right),
    x: margins.left,
    y: height - margins.top,
  };

  if (!template?.pdfContent) {
    page.drawText(invoice.business.name || 'Global LMG', {
      color: rgb(0.07, 0.09, 0.15),
      font: boldFont,
      size: 22,
      x: margins.left,
      y: height - 64,
    });
    page.drawText('Invoice', {
      color: rgb(0.42, 0.45, 0.5),
      font,
      size: 11,
      x: margins.left,
      y: height - 82,
    });
  }

  drawWrapped(canvas, invoice.template.subject || `Invoice ${invoice.invoiceNumber}`, {
    font: boldFont,
    size: 15,
  });
  canvas.y -= 8;
  drawLabelValue(canvas, 'Invoice number', invoice.invoiceNumber);
  drawLabelValue(canvas, 'Issued', formatDate(invoice.issueDate));
  drawLabelValue(canvas, 'Due', formatDate(invoice.dueDate));
  drawLabelValue(canvas, 'Status', invoice.statusCode);
  canvas.y -= 6;

  drawWrapped(canvas, 'Bill To', { font: boldFont, size: 10 });
  drawWrapped(
    canvas,
    [
      invoice.billingSnapshot?.billingName,
      invoice.billingSnapshot?.addressLine1,
      invoice.billingSnapshot?.addressLine2,
      [
        invoice.billingSnapshot?.city,
        invoice.billingSnapshot?.state,
        invoice.billingSnapshot?.postalCode,
        invoice.billingSnapshot?.countryCode,
      ]
        .filter(Boolean)
        .join(', '),
      invoice.billingSnapshot?.billingEmail,
      invoice.billingSnapshot?.billingPhone,
    ]
      .filter(Boolean)
      .join('\n'),
    { size: 8.5 }
  );
  canvas.y -= 6;

  if (invoice.template.body) {
    drawWrapped(canvas, invoice.template.body, { maxLines: 6, size: 8.5 });
    canvas.y -= 6;
  }

  const tableTop = canvas.y;
  page.drawLine({
    color: rgb(0.82, 0.84, 0.88),
    end: { x: canvas.x + canvas.width, y: tableTop + 5 },
    start: { x: canvas.x, y: tableTop + 5 },
    thickness: 0.75,
  });
  page.drawText('Description', { color: rgb(0.32, 0.35, 0.4), font: boldFont, size: 8.5, x: canvas.x, y: canvas.y });
  page.drawText('Qty', { color: rgb(0.32, 0.35, 0.4), font: boldFont, size: 8.5, x: canvas.x + canvas.width - 165, y: canvas.y });
  page.drawText('Rate', { color: rgb(0.32, 0.35, 0.4), font: boldFont, size: 8.5, x: canvas.x + canvas.width - 118, y: canvas.y });
  page.drawText('Amount', { color: rgb(0.32, 0.35, 0.4), font: boldFont, size: 8.5, x: canvas.x + canvas.width - 54, y: canvas.y });
  canvas.y -= 15;

  for (const line of invoice.lines) {
    const startY = canvas.y;
    const descLines = wrapText(line.description, font, 8.5, canvas.width - 180).slice(0, 2);
    for (const [index, descLine] of descLines.entries()) {
      page.drawText(descLine, { color: rgb(0.07, 0.09, 0.15), font, size: 8.5, x: canvas.x, y: canvas.y - index * 11 });
    }
    page.drawText(Number(line.quantity).toFixed(2), { color: rgb(0.07, 0.09, 0.15), font, size: 8.5, x: canvas.x + canvas.width - 165, y: startY });
    page.drawText(formatMoney(line.unitPrice, invoice.currencyCode), { color: rgb(0.07, 0.09, 0.15), font, size: 8.5, x: canvas.x + canvas.width - 118, y: startY });
    page.drawText(formatMoney(line.lineTotal, invoice.currencyCode), { color: rgb(0.07, 0.09, 0.15), font, size: 8.5, x: canvas.x + canvas.width - 54, y: startY });
    canvas.y -= Math.max(18, descLines.length * 11 + 8);
  }

  canvas.y -= 8;
  const totalsX = canvas.x + Math.max(0, canvas.width - 220);
  const drawTotal = (label: string, value: string, bold = false) => {
    page.drawText(label, { color: rgb(0.32, 0.35, 0.4), font: bold ? boldFont : font, size: bold ? 10 : 8.5, x: totalsX, y: canvas.y });
    page.drawText(value, { color: rgb(0.07, 0.09, 0.15), font: bold ? boldFont : font, size: bold ? 10 : 8.5, x: totalsX + 110, y: canvas.y });
    canvas.y -= bold ? 17 : 14;
  };
  drawTotal('Subtotal', formatMoney(invoice.subtotalAmount, invoice.currencyCode));
  drawTotal('Tax', formatMoney(invoice.taxAmount, invoice.currencyCode));
  drawTotal('Paid', formatMoney(invoice.amountPaid, invoice.currencyCode));
  drawTotal('Amount due', formatMoney(invoice.amountDue, invoice.currencyCode), true);
  canvas.y -= 8;

  if (invoice.business.paymentInstructions) {
    drawWrapped(canvas, 'Payment Instructions', { font: boldFont, size: 9.5 });
    drawWrapped(canvas, invoice.business.paymentInstructions, { maxLines: 4, size: 8.2 });
  }

  if (invoice.template.terms || invoice.template.footer) {
    canvas.y = Math.max(margins.bottom + 50, canvas.y - 4);
    drawWrapped(canvas, [invoice.template.terms, invoice.template.footer].filter(Boolean).join('\n'), {
      maxLines: 5,
      size: 7.8,
    });
  }

  return Buffer.from(await pdfDoc.save());
};

export const renderInvoicePdf = async (invoice: InvoiceDetail) => {
  const template = await loadInvoicePdfTemplate(invoice.id);
  return renderInvoicePdfFromTemplate(invoice, template);
};
