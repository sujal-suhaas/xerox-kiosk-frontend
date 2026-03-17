"use client";

import React, { useCallback, useRef, useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  saveFile,
  getAllFiles,
  deleteFile,
  getFile,
  createFileURL,
  isFileAccepted,
  getAcceptString,
  categorizeFile,
  type StoredFile,
  type FileCategory,
} from "@/lib/file-store";

// ── Types ──────────────────────────────────────────

export interface PrintSettings {
  paperSize: string;
  pagesPerSheet: number;
  layout: "portrait" | "landscape";
  pages: string; // "all" | "1-3" | "1,2,5" etc.
  copies: number;
  color: boolean;
  duplex: boolean;
}

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  category: FileCategory;
  pageCount: number | null;
  previewUrl: string | null;
}

export interface PageData {
  fileId: string;
  extension: string;
  dataUrl: string; // object URL for image preview / thumbnails
  arrayBuffer: ArrayBuffer; // raw file data for rendering
  mimeType: string;
  category: FileCategory;
  docPageIndex?: number; // for documents: which virtual page (0-based)
  docTotalPages?: number; // for documents: total virtual pages
}

interface PrintSettingsSidebarProps {
  open: boolean;
  onToggle: () => void;
  settings: PrintSettings;
  onSettingsChange: (settings: PrintSettings) => void;
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  printerCapabilities?: { color?: boolean; duplex?: boolean };
  onPagesChange?: (pages: PageData[], selectedIndex: number) => void;
  existingPageCount?: number;
}

// ── Helpers ────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(category: FileCategory) {
  if (category === "image") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 text-blue-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    );
  }
  if (category === "pdf") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4 text-indigo-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

// ── Component ──────────────────────────────────────

export default function PrintSettingsSidebar({
  open,
  onToggle,
  settings,
  onSettingsChange,
  files,
  onFilesChange,
  printerCapabilities,
  onPagesChange,
  existingPageCount = 0,
}: PrintSettingsSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const totalPages = files.reduce((acc, f) => acc + (f.pageCount ?? 1), 0);

  const update = useCallback(
    (partial: Partial<PrintSettings>) => {
      onSettingsChange({ ...settings, ...partial });
    },
    [settings, onSettingsChange],
  );

  // ── File Upload ────────

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      if (!selected || selected.length === 0) return;

      setUploading(true);
      const newFiles: UploadedFile[] = [];
      const newPages: PageData[] = [];

      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        if (!isFileAccepted(file)) continue;

        const arrayBuffer = await new Promise<ArrayBuffer>((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result as ArrayBuffer);
          reader.onerror = () => rej(reader.error);
          reader.readAsArrayBuffer(file);
        });

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const category = categorizeFile(file);
        const ext = file.name.split(".").pop()?.toLowerCase() || "";

        const storedFile: StoredFile = {
          id,
          name: file.name,
          type: file.type,
          size: file.size,
          data: arrayBuffer,
          createdAt: Date.now(),
        };

        await saveFile(storedFile);

        // Estimate page count: images = 1, PDFs = parse, docs = unknown
        let pageCount: number | null = 1;
        if (category === "pdf") {
          // Quick heuristic: count /Type /Page in the PDF
          try {
            const text = new TextDecoder("latin1").decode(arrayBuffer);
            const matches = text.match(/\/Type\s*\/Page[^s]/g);
            pageCount = matches ? matches.length : 1;
          } catch {
            pageCount = 1;
          }
        } else if (category === "document") {
          // Render offscreen with docx-preview to measure total height and determine page count
          try {
            const dp = await import("docx-preview");
            const offscreen = document.createElement("div");
            offscreen.style.position = "fixed";
            offscreen.style.left = "-9999px";
            offscreen.style.width = "794px"; // A4 width at 96dpi
            offscreen.style.background = "white";
            document.body.appendChild(offscreen);

            await dp.renderAsync(arrayBuffer.slice(0), offscreen, undefined, {
              className: "docx-preview",
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: false,
            });
            await new Promise((r) => setTimeout(r, 400));

            const totalHeight = offscreen.scrollHeight;
            const a4Height = 1123; // A4 height at 96dpi
            pageCount = Math.max(1, Math.ceil(totalHeight / a4Height));
            document.body.removeChild(offscreen);
          } catch {
            pageCount = 1;
          }
        }

        // Create preview URL for images & PDFs
        let filePreviewUrl: string | null = null;
        if (category === "image" || category === "pdf") {
          filePreviewUrl = createFileURL(storedFile);
        }

        // Build data URL for page state
        const blob = new Blob([arrayBuffer], { type: file.type });
        const dataUrl = URL.createObjectURL(blob);

        // For PDFs and documents with multiple pages, add one entry per page
        const actualPageCount = pageCount ?? 1;
        if (
          (category === "pdf" || category === "document") &&
          actualPageCount > 1
        ) {
          for (let p = 0; p < actualPageCount; p++) {
            newPages.push({
              fileId: id,
              extension: ext,
              dataUrl,
              arrayBuffer: arrayBuffer.slice(0),
              mimeType: file.type,
              category,
              ...(category === "document"
                ? { docPageIndex: p, docTotalPages: actualPageCount }
                : {}),
            });
          }
        } else {
          newPages.push({
            fileId: id,
            extension: ext,
            dataUrl,
            arrayBuffer: arrayBuffer.slice(0),
            mimeType: file.type,
            category,
            ...(category === "document"
              ? { docPageIndex: 0, docTotalPages: 1 }
              : {}),
          });
        }

        newFiles.push({
          id,
          name: file.name,
          type: file.type,
          size: file.size,
          category,
          pageCount,
          previewUrl: filePreviewUrl,
        });
      }

      const allFiles = [...files, ...newFiles];
      onFilesChange(allFiles);

      // Notify parent about pages
      if (onPagesChange && newPages.length > 0) {
        const firstNewIndex = existingPageCount;
        onPagesChange(newPages, firstNewIndex);
      }

      setUploading(false);

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [files, onFilesChange, onPagesChange, existingPageCount],
  );

  const handleRemoveFile = useCallback(
    async (id: string) => {
      const f = files.find((f) => f.id === id);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      await deleteFile(id);
      onFilesChange(files.filter((f) => f.id !== id));
    },
    [files, onFilesChange],
  );

  const handlePreview = useCallback(
    async (f: UploadedFile) => {
      if (f.category === "document") return; // Can't preview doc/docx inline
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const stored = await getFile(f.id);
      if (!stored) return;
      const url = createFileURL(stored);
      setPreviewUrl(url);
      setPreviewName(f.name);
    },
    [previewUrl],
  );

  const closePreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewName("");
  }, [previewUrl]);

  // ── Render ─────────────

  return (
    <>
      {/* Toggle button (visible when sidebar is closed) */}
      {!open && (
        <button
          onClick={onToggle}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-30 bg-white dark:bg-zinc-900 border border-r-0 rounded-l-md p-2 shadow-md hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          title="Open print settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-zinc-600 dark:text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}

      {/* Sidebar */}
      <aside
        className={`shrink-0 border-l bg-white dark:bg-zinc-900 transition-all duration-300 overflow-hidden flex flex-col ${
          open ? "w-80" : "w-0"
        }`}
      >
        <div className="flex-1 overflow-y-auto w-80">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Print Settings
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {totalPages} {totalPages === 1 ? "page" : "pages"}
              </span>
              <button
                onClick={onToggle}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Close settings"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-zinc-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Upload Area */}
          <div className="px-4 pt-4 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={getAcceptString()}
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg py-6 flex flex-col items-center gap-2 hover:border-blue-400 hover:bg-blue-50/50 dark:hover:border-blue-500 dark:hover:bg-blue-950/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {uploading ? "Uploading…" : "Upload files"}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                Images, PDF, DOC, DOCX
              </span>
            </button>
          </div>

          {/* Uploaded Files */}
          {files.length > 0 && (
            <div className="px-4 pb-3">
              <div className="space-y-1.5">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm group hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    {fileIcon(f.category)}
                    <button
                      onClick={() => handlePreview(f)}
                      className={`flex-1 min-w-0 text-left truncate ${
                        f.category !== "document"
                          ? "hover:text-blue-600 cursor-pointer"
                          : "cursor-default"
                      }`}
                      title={f.name}
                      disabled={f.category === "document"}
                    >
                      {f.name}
                    </button>
                    <span className="text-xs text-zinc-400 shrink-0">
                      {formatSize(f.size)}
                    </span>
                    <button
                      onClick={() => handleRemoveFile(f.id)}
                      className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center h-5 w-5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
                      title="Remove"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 text-red-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t mx-4" />

          {/* Settings */}
          <div className="px-4 py-4 space-y-5">
            {/* Paper Size */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Paper size
              </label>
              <Select
                value={settings.paperSize}
                onValueChange={(v) => update({ paperSize: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Pages Per Sheet */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Pages per sheet
              </label>
              <Select
                value={String(settings.pagesPerSheet)}
                onValueChange={(v) => update({ pagesPerSheet: Number(v) })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="9">9</SelectItem>
                  <SelectItem value="16">16</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Layout */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Layout
              </label>
              <Select
                value={settings.layout}
                onValueChange={(v) =>
                  update({ layout: v as "portrait" | "landscape" })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Pages */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Pages
              </label>
              <Select
                value={settings.pages === "all" ? "all" : "custom"}
                onValueChange={(v) => {
                  if (v === "all") update({ pages: "all" });
                  else update({ pages: "" });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {settings.pages !== "all" && (
                <input
                  type="text"
                  placeholder="e.g. 1-3, 5, 8"
                  value={settings.pages}
                  onChange={(e) => update({ pages: e.target.value })}
                  className="mt-1.5 w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-zinc-200"
                />
              )}
            </div>

            {/* Copies */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Copies
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.copies}
                onChange={(e) =>
                  update({
                    copies: Math.max(
                      1,
                      Math.min(10, Number(e.target.value) || 1),
                    ),
                  })
                }
                className="w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:text-zinc-200"
              />
            </div>

            {/* Color */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Color
              </label>
              <Select
                value={settings.color ? "color" : "bw"}
                onValueChange={(v) => update({ color: v === "color" })}
                disabled={!printerCapabilities?.color}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bw">Black & White</SelectItem>
                  {printerCapabilities?.color && (
                    <SelectItem value="color">Color</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {!printerCapabilities?.color && (
                <p className="text-xs text-zinc-400">
                  Printer does not support color
                </p>
              )}
            </div>

            {/* Duplex */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Double-sided
              </label>
              <Select
                value={settings.duplex ? "true" : "false"}
                onValueChange={(v) => update({ duplex: v === "true" })}
                disabled={!printerCapabilities?.duplex}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Off</SelectItem>
                  {printerCapabilities?.duplex && (
                    <SelectItem value="true">On</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {!printerCapabilities?.duplex && (
                <p className="text-xs text-zinc-400">
                  Printer does not support duplex
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closePreview}
        >
          <div
            className="relative bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-4xl max-h-[90vh] w-full overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-medium truncate">
                {previewName}
              </span>
              <button
                onClick={closePreview}
                className="h-7 w-7 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center justify-center"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              {previewName.toLowerCase().endsWith(".pdf") ? (
                <iframe src={previewUrl} className="w-full h-[75vh] rounded" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={previewName}
                  className="max-w-full max-h-[75vh] object-contain rounded"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
