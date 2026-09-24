const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js');

const execFileAsync = promisify(execFile);

function quoteForPowerShell(value) {
    return String(value).replaceAll("'", "''");
}

async function resolveWindowsExecutable(executableNames = []) {
    for (const executableName of executableNames) {
        if (!executableName) {
            continue;
        }

        try {
            const { stdout } = await execFileAsync('where', [executableName], {
                windowsHide: true,
                timeout: 10000,
            });
            const firstPath = String(stdout || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find(Boolean);

            if (firstPath && fs.existsSync(firstPath)) {
                return firstPath;
            }
        } catch {
            // Ignore lookup failures and continue.
        }
    }

    const commonCandidatePaths = [
        path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe'),
        path.join(process.env.ProgramFiles || '', 'SumatraPDF', 'SumatraPDF.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'SumatraPDF', 'SumatraPDF.exe'),
        path.join(process.env.ProgramFiles || '', 'Adobe', 'Acrobat DC', 'Acrobat', 'Acrobat.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Adobe', 'Acrobat Reader DC', 'Reader', 'AcroRd32.exe'),
    ].filter(Boolean);

    for (const candidate of commonCandidatePaths) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function tryWindowsPdfAppPrint(pdfPath, printerName, timeoutMs) {
    const explicitPdfAppPath = process.env.SKU_LABEL_PDF_APP_PATH
        ? path.resolve(process.env.SKU_LABEL_PDF_APP_PATH)
        : null;

    const pdfAppPath = explicitPdfAppPath && fs.existsSync(explicitPdfAppPath)
        ? explicitPdfAppPath
        : await resolveWindowsExecutable(['SumatraPDF.exe', 'AcroRd32.exe', 'Acrobat.exe', 'msedge.exe', 'chrome.exe']);

    if (!pdfAppPath) {
        return false;
    }

    const appName = path.basename(pdfAppPath).toLowerCase();
    if (appName === 'sumatrapdf.exe') {
        const args = printerName
            ? ['-print-to', printerName, '-silent', pdfPath]
            : ['-print-to-default', '-silent', pdfPath];
        await execFileAsync(pdfAppPath, args, {
            windowsHide: true,
            timeout: timeoutMs,
        });
        return true;
    }

    if (appName === 'acrord32.exe' || appName === 'acrobat.exe') {
        const args = ['/N', '/T', pdfPath];
        if (printerName) {
            args.push(printerName);
        }
        await execFileAsync(pdfAppPath, args, {
            windowsHide: true,
            timeout: timeoutMs,
        });
        return true;
    }

    if (appName === 'msedge.exe' || appName === 'chrome.exe') {
        const args = ['/p', pdfPath];
        await execFileAsync(pdfAppPath, args, {
            windowsHide: false,
            timeout: timeoutMs,
        });
        return true;
    }

    return false;
}

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

async function printPdfFile(pdfFilePath) {
    const absolutePdfPath = path.resolve(pdfFilePath);
    const printerName = typeof process.env.SKU_LABEL_PRINTER === 'string' && process.env.SKU_LABEL_PRINTER.trim()
        ? process.env.SKU_LABEL_PRINTER.trim()
        : null;
    const printTimeoutMs = Number(process.env.SKU_LABEL_PRINT_TIMEOUT_MS) > 0
        ? Number(process.env.SKU_LABEL_PRINT_TIMEOUT_MS)
        : 120000;
    const printCommand = process.env.SKU_LABEL_PRINT_COMMAND;
    const printCommandArgs = process.env.SKU_LABEL_PRINT_ARGS_JSON;

    if (typeof printCommand === 'string' && printCommand.trim()) {
        let args = [];
        if (typeof printCommandArgs === 'string' && printCommandArgs.trim()) {
            try {
                const parsed = JSON.parse(printCommandArgs);
                if (Array.isArray(parsed)) {
                    args = parsed;
                }
            } catch {
                args = [];
            }
        }

        args = args.map((arg) => String(arg).replaceAll('{file}', absolutePdfPath));

        if (!printCommand || typeof printCommand !== 'string') {
            throw new Error('SKU_LABEL_PRINT_COMMAND must be a non-empty string when provided.');
        }

        await execFileAsync(printCommand, args, {
            windowsHide: true,
            timeout: printTimeoutMs,
        });
        return;
    }

    if (process.platform === 'win32') {
        const psScript = printerName
            ? `Start-Process -FilePath '${quoteForPowerShell(absolutePdfPath)}' -Verb PrintTo -ArgumentList '${quoteForPowerShell(printerName)}' -Wait`
            : `Start-Process -FilePath '${quoteForPowerShell(absolutePdfPath)}' -Verb Print -Wait`;

        try {
            await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
                windowsHide: true,
                timeout: printTimeoutMs,
            });
            return;
        } catch (err) {
            const stderrText = String(err?.stderr || '');
            const cannotUseVerb = /No application is associated|This command cannot be run due to the error/i.test(stderrText);

            if (!cannotUseVerb) {
                throw err;
            }

            const fallbackWorked = await tryWindowsPdfAppPrint(absolutePdfPath, printerName, printTimeoutMs)
                .catch(() => false);

            if (fallbackWorked) {
                return;
            }

            throw new Error(
                'Unable to print PDF on Windows. No default PDF print association was found and no compatible PDF app fallback was detected. ' +
                'Install SumatraPDF or Adobe Reader, or configure SKU_LABEL_PRINT_COMMAND (and optional SKU_LABEL_PRINT_ARGS_JSON). '
                + 'If Edge/Chrome are installed, they may still require UI interaction depending on system policy.'
            );
        }
    }

    const lpArgs = [];
    if (printerName) {
        lpArgs.push('-d', printerName);
    }
    lpArgs.push(absolutePdfPath);

    await execFileAsync('lp', lpArgs, {
        windowsHide: true,
        timeout: printTimeoutMs,
    });
}

async function generatePrintAndDiscardSkuLabelPdf(sku) {
    const tempDir = os.tmpdir();
    const tempFileName = `sku-label-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
    const tempPdfPath = path.join(tempDir, tempFileName);

    try {
        await generateSkuLabelPdfFile(sku, tempPdfPath);
        await printPdfFile(tempPdfPath);
        return { ok: true, printed: true };
    } finally {
        await fs.promises.unlink(tempPdfPath).catch(() => undefined);
    }
}

module.exports = {
    generateSkuLabelPdf,
    generateSkuLabelPdfFile,
    printPdfFile,
    generatePrintAndDiscardSkuLabelPdf,
};
