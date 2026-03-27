import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export class DocumentParser {
  /**
   * Parse a document file and extract text content.
   * Supports: .md, .txt (native), .pdf (via pdftotext CLI), .docx (via textutil CLI on macOS)
   */
  async parse(filePath: string): Promise<{ text: string; metadata: { format: string; pages?: number } }> {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.md':
      case '.txt':
        return this.parsePlainText(filePath, ext.slice(1));
      case '.pdf':
        return this.parsePDF(filePath);
      case '.docx':
        return this.parseDOCX(filePath);
      default:
        throw new Error(`Unsupported file format: ${ext}. Please use .md, .txt, .pdf, or .docx`);
    }
  }

  private async parsePlainText(filePath: string, format: string) {
    const text = fs.readFileSync(filePath, 'utf-8');
    return { text, metadata: { format } };
  }

  private async parsePDF(filePath: string) {
    try {
      // Use execFileSync to avoid shell injection — arguments passed as array
      const text = execFileSync('pdftotext', [filePath, '-'], { encoding: 'utf-8', timeout: 30000 });
      return { text: text.trim(), metadata: { format: 'pdf' } };
    } catch {
      throw new Error(
        'PDF parsing failed. Please install pdftotext (brew install poppler) or convert your resume to .md/.txt format.'
      );
    }
  }

  private async parseDOCX(filePath: string) {
    const tmpFile = filePath + '.tmp.txt';
    try {
      // Use execFileSync to avoid shell injection — arguments passed as array
      execFileSync('textutil', ['-convert', 'txt', '-output', tmpFile, filePath], { timeout: 30000 });
      const text = fs.readFileSync(tmpFile, 'utf-8');
      return { text: text.trim(), metadata: { format: 'docx' } };
    } catch {
      throw new Error(
        'DOCX parsing failed. Please convert your resume to .md/.txt format.'
      );
    } finally {
      // Clean up temp file regardless of success/failure
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
}
