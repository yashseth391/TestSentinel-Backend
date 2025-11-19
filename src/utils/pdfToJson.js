import { PDFParse } from "pdf-parse";

export default async function convertPdfToJson(buffer) {
  const data = new PDFParse(buffer);
  const result = await data.getText();
  // You can customise this later
  return { text: result.text };
}
