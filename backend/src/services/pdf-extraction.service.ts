import fs from 'fs';
const { PDFParse } = require('pdf-parse');

const normalizeText = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
};

export const extractTextFromPdf = async (filePath: string): Promise<string> => {
  if (!fs.existsSync(filePath)) {
    throw new Error('FILE_NOT_FOUND');
  }

  try {
    const dataBuffer = fs.readFileSync(filePath);
    // pdf-parse v2 API; an empty pageJoiner omits the default "-- N of M --" page markers.
    const parser = new PDFParse({ data: dataBuffer });
    let data;
    try {
      data = await parser.getText({ pageJoiner: '' });
    } finally {
      await parser.destroy();
    }

    if (!data || !data.text || data.text.trim() === '') {
      throw new Error('NO_TEXT');
    }

    const normalizedText = normalizeText(data.text);

    if (normalizedText.length === 0) {
      throw new Error('NO_TEXT');
    }

    return normalizedText;
  } catch (error: any) {
    if (error.message === 'NO_TEXT' || error.message === 'FILE_NOT_FOUND') {
      throw error;
    }
    throw new Error('PDF_PARSE_ERROR');
  }
};
