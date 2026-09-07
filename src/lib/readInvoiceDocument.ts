import { invoiceFileType } from "../../shared/invoiceSource";
import { extractInvoiceSuggestions } from "../../shared/invoiceExtraction";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export async function readInvoiceDocument(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = invoiceFileType(bytes, file.type);
  let text = "",
    preview: string | undefined,
    pages = 1;
  if (type === "text/plain")
    text = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .slice(0, 200_000);
  else if (type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    // Only the display API is used. No viewer, scripting manager, annotations,
    // embedded files, actions or external links are executed.
    const task = pdfjs.getDocument({
      data: bytes,
      enableXfa: false,
      maxImageSize: 4_000_000,
      useWorkerFetch: false,
      stopAtErrors: true,
    });
    const timer = setTimeout(() => {
      void task.destroy();
    }, 30_000);
    try {
      const pdf = await task.promise;
      pages = pdf.numPages;
      if (pages > 30)
        throw new Error(
          "This document has more than 30 pages. Attach it and enter its details manually.",
        );
      for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let lastY: number | undefined;
        for (const item of content.items)
          if ("str" in item) {
            const y = item.transform[5];
            if (
              lastY !== undefined &&
              Math.abs(y - lastY) > 3 &&
              !text.endsWith("\n")
            )
              text += "\n";
            text += item.str + (item.hasEOL ? "\n" : " ");
            lastY = y;
            if (text.length > 200_000)
              throw new Error(
                "There is too much text to extract reliably. Enter the bill details manually.",
              );
          }
        text += "\n";
        if (i === 1) {
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(
            1.5,
            900 / base.width,
            Math.sqrt(1_200_000 / (base.width * base.height)),
          );
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (context) {
            await page.render({
              canvas,
              canvasContext: context,
              viewport,
              annotationMode: pdfjs.AnnotationMode.DISABLE,
            }).promise;
            preview = canvas.toDataURL("image/png");
          }
        }
        page.cleanup();
      }
    } finally {
      clearTimeout(timer);
      await task.destroy();
    }
  }
  const suggestions = extractInvoiceSuggestions(text);
  if (type.startsWith("image/") || !text.trim())
    suggestions.warnings = [
      "This source needs manual entry. Image and scanned-document OCR is not available in the local reader.",
    ];
  return { text, preview, pages, suggestions, contentType: type };
}
