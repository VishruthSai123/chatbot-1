/**
 * Ambient type declaration for pdfjs-dist worker entrypoint.
 *
 * The legacy worker bundle is dynamically imported in server environments
 * to register the WorkerMessageHandler on globalThis before pdfjs executes.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
