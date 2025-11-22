import { PDFParse } from "pdf-parse";

export default async function convertPdfToJson(buffer) {
  const uint8Array = new Uint8Array(buffer);
  const data = new PDFParse(uint8Array);
  const result = await data.getText();
  // You can customise this later
  return { text: result.text };
}
