declare module "pdfjs-dist/legacy/build/pdf" {
  export * from "pdfjs-dist/types/src/display/api";
  const pdfjs: typeof import("pdfjs-dist/types/src/display/api");
  export = pdfjs;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist/types/src/display/api";
  const pdfjs: typeof import("pdfjs-dist/types/src/display/api");
  export = pdfjs;
}
