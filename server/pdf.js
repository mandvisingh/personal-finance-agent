import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createLogger } from "./logger.js";

const log = createLogger("pdf");

export async function pdfParse(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }

  log.debug(`Parsed ${doc.numPages} pages, ${text.length} chars`);
  return { text, numpages: doc.numPages };
}
