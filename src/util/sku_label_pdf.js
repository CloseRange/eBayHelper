const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const POINTS_PER_INCH = 72;
const LABEL_SIZE = [4 * POINTS_PER_INCH, 6 * POINTS_PER_INCH];
const DEFAULT_LOGO_PATH = path.resolve(__dirname, '../../public/res/logo.png');

function formatCreatedAt(createdAt) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
    }).format(createdAt);
}

async function generateSkuLabelPdf(sku, options = {}) {
    const normalizedSku = String(sku || '').trim();
    if (!normalizedSku) {
        throw new Error('A SKU is required to generate a label PDF.');
    }

    const createdAt = options.createdAt ? new Date(options.createdAt) : new Date();
    if (Number.isNaN(createdAt.getTime())) {
        throw new Error('Invalid createdAt value.');
    }

    const logoPath = options.logoPath
        ? path.resolve(options.logoPath)
        : DEFAULT_LOGO_PATH;

    if (!fs.existsSync(logoPath)) {
        throw new Error(`Logo file not found at: ${logoPath}`);
    }

    const barcodeBuffer = await bwipjs.toBuffer({
        bcid: 'code128',
        text: normalizedSku,
        scale: 2,
        height: 12,
        includetext: false,
        backgroundcolor: 'FFFFFF',
    });

    const doc = new PDFDocument({
        size: LABEL_SIZE,
        margin: 0,
        info: {
            Title: `SKU Label ${normalizedSku}`,
            Author: 'eBayHelper',
            Subject: '4x6 SKU barcode label',
        },
    });

    return new Promise((resolve, reject) => {
        const chunks = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        const margin = 18;
        const contentWidth = pageWidth - margin * 2;

        doc.fillColor('black');

        const logoX = 0;
        const logoY = 0;
        const logoWidth = pageWidth;
        const logoHeight = Math.floor((pageHeight * 4) / 6);
        const logoPadding = 12;
        doc.image(logoPath, logoX + logoPadding, logoY + logoPadding, {
            fit: [logoWidth - (logoPadding * 2), logoHeight - (logoPadding * 2)],
            align: 'center',
            valign: 'center',
        });

        const barcodeY = logoY + logoHeight + 18;
        const barcodeWidth = contentWidth - 112;
        const barcodeHeight = 46;
        const barcodeX = margin + (contentWidth - barcodeWidth) / 2;

        doc.image(barcodeBuffer, barcodeX, barcodeY, {
            fit: [barcodeWidth, barcodeHeight],
            align: 'center',
            valign: 'center',
        });

        const skuTextY = barcodeY + barcodeHeight + 14;
        doc
            .font('Helvetica-Bold')
            .fontSize(32)
            .fillColor('black')
            .text(normalizedSku, margin, skuTextY, {
                width: contentWidth,
                align: 'center',
                lineBreak: false,
            });

        const createdText = formatCreatedAt(createdAt);
        const createdLabelY = pageHeight - 20;
        doc
            .font('Helvetica')
            .fontSize(12)
            .fillColor('black')
            .text(createdText, margin, createdLabelY, {
                width: contentWidth,
                align: 'center',
                lineBreak: false,
            });

        doc.end();
    });
}

async function generateSkuLabelPdfFile(sku, outputFilePath, options = {}) {
    const pdfBuffer = await generateSkuLabelPdf(sku, options);
    await fs.promises.writeFile(outputFilePath, pdfBuffer);
    return outputFilePath;
}

module.exports = {
    generateSkuLabelPdf,
    generateSkuLabelPdfFile,
};
