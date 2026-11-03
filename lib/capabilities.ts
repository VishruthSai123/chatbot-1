/*
 * What the app can do, in one place.
 *
 * The app has eight families of tools, and a user who lands on an empty chat
 * has no way to discover any of them from a blank composer. This is the
 * catalogue the empty state and the capabilities panel are built from, kept as
 * data so the two never drift apart.
 */

export type Capability = {
  /** A stable id, used to open the panel on this family. */
  id: string;
  /** The family's name, as a user would say it. */
  name: string;
  /** One line, in plain language. */
  description: string;
  /** Prompts that demonstrate it, best first. */
  examples: string[];
  /** The lucide icon to draw. */
  icon:
    | "image"
    | "file-text"
    | "table"
    | "book-open"
    | "audio"
    | "notebook"
    | "search"
    | "download";
};

export const capabilities: Capability[] = [
  {
    description: "Remove backgrounds, resize, crop, combine, convert.",
    examples: [
      "Remove the background from this photo",
      "Resize this image to 800 pixels wide",
      "Put these screenshots into one tall image",
    ],
    icon: "image",
    id: "images",
    name: "Images",
  },
  {
    description: "Merge, split, rotate and convert PDFs.",
    examples: [
      "Merge these PDFs into one file",
      "Split this PDF into single pages",
      "Turn these images into a PDF",
    ],
    icon: "file-text",
    id: "pdf",
    name: "PDF",
  },
  {
    description: "Read, filter, summarise and convert spreadsheets.",
    examples: [
      "Summarise this spreadsheet",
      "Convert this CSV to Excel",
      "What are the totals in this sheet?",
    ],
    icon: "table",
    id: "sheets",
    name: "Sheets",
  },
  {
    description: "Read, compare, summarise and convert documents.",
    examples: [
      "Compare these two documents",
      "Summarise this DOCX with its outline",
      "Convert this document to Markdown",
    ],
    icon: "book-open",
    id: "documents",
    name: "Documents",
  },
  {
    description: "Waveform, transcript and captions for recordings.",
    examples: [
      "Transcribe this recording with timestamps",
      "Show me the waveform of this audio",
      "Give me a caption file for this video",
    ],
    icon: "audio",
    id: "audio",
    name: "Audio & video",
  },
  {
    description: "Ask across many sources at once, with citations.",
    examples: [
      "Make a notebook from these files",
      "Quiz me on this notebook",
      "What do these sources disagree about?",
    ],
    icon: "notebook",
    id: "notebooks",
    name: "Notebooks",
  },
  {
    description: "Search the web and write a sourced report.",
    examples: [
      "Research the latest Next.js release",
      "What happened in AI this week?",
      "Find the current price of this product",
    ],
    icon: "search",
    id: "research",
    name: "Research",
  },
  {
    description: "Save video and audio from a link.",
    examples: [
      "Download this YouTube video as audio",
      "Save this Instagram reel",
      "Get the transcript of this video",
    ],
    icon: "download",
    id: "downloads",
    name: "Downloads",
  },
];

/**
 * The four prompts shown on an empty chat.
 *
 * Each one is a real task the app can do *right now*, with no attachment and
 * no setup, so the first click teaches something rather than asking for a file.
 */
export const starterPrompts = [
  "What is the latest Next.js release, with sources?",
  "Make a notebook that can answer from a web page",
  "Explain how to merge PDFs in this app",
  "What can you do with images?",
];
