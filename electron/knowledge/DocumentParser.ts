import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
    const text = await fs.promises.readFile(filePath, 'utf-8');
    return { text, metadata: { format } };
  }

  private async parsePDF(filePath: string) {
    try {
      const { stdout: text } = await execFileAsync('pdftotext', [filePath, '-'], { encoding: 'utf-8', timeout: 30000 });
      return { text: text.trim(), metadata: { format: 'pdf' } };
    } catch {
      throw new Error(
        'PDF parsing failed. Please install pdftotext (brew install poppler) or convert the document to .md/.txt format.'
      );
    }
  }

  private async parseDOCX(filePath: string) {
    try {
      if (process.platform !== 'darwin') throw new Error('DOCX conversion requires macOS');
      const { stdout: text } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath], { encoding: 'utf-8', timeout: 30000 });
      return { text: text.trim(), metadata: { format: 'docx' } };
    } catch {
      throw new Error(
        'DOCX parsing failed. Please convert the document to .md/.txt format.'
      );
    }
  }
}
