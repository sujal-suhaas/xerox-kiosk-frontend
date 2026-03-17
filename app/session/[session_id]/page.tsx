"use client";

import { use, useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  isAuthenticated,
  clearToken,
  default as axiosInstance,
} from "@/lib/auth";
import { Progress } from "@/components/ui/progress";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import PrintSettingsSidebar, {
  type PrintSettings,
  type PageData,
} from "@/components/print-settings-sidebar";
import { getFile, createFileURL } from "@/lib/file-store";
import Link from "next/link";
import { PAPER_SIZE_RATIO } from "@/constants";
import type * as PdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";

// Lazy-load pdfjs-dist & docx-preview only in the browser
let pdfjsLib: typeof PdfjsLib | null = null;
let docxPreview: any = null;
const getPdfjs = async () => {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
};
const getDocxPreview = async () => {
  if (!docxPreview) {
    docxPreview = await import("docx-preview");
  }
  return docxPreview;
};

// A4 dimensions at 96 DPI
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

interface SessionPageProps {
  params: Promise<{
    session_id: string;
  }>;
}

export default function SessionPage({ params }: SessionPageProps) {
  const { session_id } = use(params);
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      const nextPath =
        `/session/${session_id}` +
        (token ? `?token=${encodeURIComponent(token)}` : "");
      router.push(`/login?next=${encodeURIComponent(nextPath)}`);
    }
  }, [router, session_id, token]);

  const [printerData, setPrinterData] = useState<Record<string, any> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInvalid, setSessionInvalid] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // Print settings state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [printSettings, setPrintSettings] = useState<PrintSettings>({
    paperSize: "A4",
    pagesPerSheet: 1,
    layout: "portrait",
    pages: "all",
    copies: 1,
    color: false,
    duplex: false,
  });
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [pages, setPages] = useState<PageData[]>([]);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const handleFilesChange = useCallback((newFiles: any[]) => {
    const newFileIds = new Set(newFiles.map((f) => f.id));
    setUploadedFiles(newFiles);
    setPages((prev) => {
      const filtered = prev.filter((p) => newFileIds.has(p.fileId));
      // Adjust selectedPage if needed
      setSelectedPage((sel) => {
        if (sel === null) return null;
        if (filtered.length === 0) return null;
        if (sel >= filtered.length) return filtered.length - 1;
        return sel;
      });
      return filtered;
    });
  }, []);

  const handlePagesChange = useCallback(
    (newPages: PageData[], selectedIndex: number) => {
      setPages((prev) => {
        const updated = [...prev, ...newPages];
        setSelectedPage(prev.length === 0 ? 0 : prev.length);
        return updated;
      });
    },
    [],
  );

  // Render preview for the selected page
  useEffect(() => {
    if (
      selectedPage === null ||
      !pages[selectedPage] ||
      !previewContainerRef.current
    )
      return;
    const container = previewContainerRef.current;
    container.innerHTML = "";

    const page = pages[selectedPage];

    if (page.category === "image") {
      const img = document.createElement("img");
      img.src = page.dataUrl;
      img.alt = "Preview";
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      container.appendChild(img);
    } else if (page.category === "pdf") {
      // Render the specific PDF page using pdf.js
      (async () => {
        try {
          const pdfjs = await getPdfjs();
          const pdf = await pdfjs.getDocument({
            data: page.arrayBuffer.slice(0),
          }).promise;

          // Find which page index within the PDF this entry represents
          let pdfPageIndex = 0;
          for (let i = 0; i < selectedPage; i++) {
            if (pages[i].fileId === page.fileId) pdfPageIndex++;
          }
          const pdfPage = await pdf.getPage(pdfPageIndex + 1);

          const containerWidth = container.clientWidth || 500;
          const viewport = pdfPage.getViewport({ scale: 1 });
          const scale = containerWidth / viewport.width;
          const scaledViewport = pdfPage.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          await pdfPage.render({ canvas, viewport: scaledViewport } as any)
            .promise;
          if (container === previewContainerRef.current) {
            container.innerHTML = "";
            container.appendChild(canvas);
          }
        } catch (err) {
          console.error("PDF render error:", err);
          container.innerHTML =
            '<p class="text-sm text-red-500">Failed to render PDF page</p>';
        }
      })();
    } else if (page.category === "document") {
      // Render DOCX using docx-preview with page clipping
      (async () => {
        try {
          const dp = await getDocxPreview();
          // Create an offscreen container to render the full document
          const offscreen = document.createElement("div");
          offscreen.style.position = "fixed";
          offscreen.style.left = "-9999px";
          offscreen.style.width = `${A4_WIDTH_PX}px`;
          offscreen.style.background = "white";
          document.body.appendChild(offscreen);

          await dp.renderAsync(
            page.arrayBuffer.slice(0),
            offscreen,
            undefined,
            {
              className: "docx-preview",
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: false,
            },
          );

          // Wait a moment for fonts/images to load
          await new Promise((r) => setTimeout(r, 300));

          const totalHeight = offscreen.scrollHeight;
          const pageIndex = page.docPageIndex ?? 0;

          // Create a visible wrapper that clips to the current page
          const wrapper = document.createElement("div");
          wrapper.style.width = "100%";
          wrapper.style.height = "100%";
          wrapper.style.overflow = "hidden";
          wrapper.style.position = "relative";
          wrapper.style.background = "white";

          // Move the rendered content from offscreen to visible
          const inner = document.createElement("div");
          inner.style.position = "absolute";
          inner.style.top = `-${pageIndex * A4_HEIGHT_PX}px`;
          inner.style.left = "0";
          inner.style.width = `${A4_WIDTH_PX}px`;
          inner.style.transformOrigin = "top left";
          // Scale to fit the container width
          const containerWidth = container.clientWidth || A4_WIDTH_PX;
          const scaleFactor = containerWidth / A4_WIDTH_PX;
          inner.style.transform = `scale(${scaleFactor})`;
          wrapper.style.height = `${A4_HEIGHT_PX * scaleFactor}px`;

          // Move rendered children from offscreen
          while (offscreen.firstChild) {
            inner.appendChild(offscreen.firstChild);
          }
          document.body.removeChild(offscreen);

          wrapper.appendChild(inner);

          if (container === previewContainerRef.current) {
            container.innerHTML = "";
            container.appendChild(wrapper);
          }
        } catch (err) {
          console.error("Document render error:", err);
          container.innerHTML =
            '<p class="text-sm text-red-500">Failed to render document</p>';
        }
      })();
    }
  }, [selectedPage, pages]);

  // Helper: convert a single page to a jsPDF page as image
  const pageToImageData = useCallback(
    async (
      page: PageData,
    ): Promise<{ data: string; width: number; height: number }> => {
      if (page.category === "image") {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0);
            resolve({
              data: canvas.toDataURL("image/jpeg", 0.92),
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
          };
          img.onerror = reject;
          img.src = page.dataUrl;
        });
      } else if (page.category === "pdf") {
        const pdfjs = await getPdfjs();
        const pdf = await pdfjs.getDocument({ data: page.arrayBuffer.slice(0) })
          .promise;
        // Determine which page within the PDF
        let pdfPageIdx = 0;
        const pageGlobalIdx = pages.indexOf(page);
        for (let i = 0; i < pageGlobalIdx; i++) {
          if (pages[i].fileId === page.fileId) pdfPageIdx++;
        }
        const pdfPage = await pdf.getPage(pdfPageIdx + 1);
        const viewport = pdfPage.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPage.render({ canvas, viewport } as any).promise;
        return {
          data: canvas.toDataURL("image/jpeg", 0.92),
          width: viewport.width,
          height: viewport.height,
        };
      } else {
        // document - render docx-preview offscreen, capture page as image
        const dp = await getDocxPreview();
        const offscreen = document.createElement("div");
        offscreen.style.position = "fixed";
        offscreen.style.left = "-9999px";
        offscreen.style.width = `${A4_WIDTH_PX}px`;
        offscreen.style.background = "white";
        document.body.appendChild(offscreen);

        await dp.renderAsync(page.arrayBuffer.slice(0), offscreen, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });
        await new Promise((r) => setTimeout(r, 500));

        const pageIndex = page.docPageIndex ?? 0;
        const { default: html2canvas } = await import("html2canvas-pro");

        // Capture the slice of the document for this page
        const captureCanvas = await html2canvas(offscreen, {
          width: A4_WIDTH_PX,
          height: A4_HEIGHT_PX,
          x: 0,
          y: pageIndex * A4_HEIGHT_PX,
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
        });

        document.body.removeChild(offscreen);
        return {
          data: captureCanvas.toDataURL("image/jpeg", 0.92),
          width: captureCanvas.width,
          height: captureCanvas.height,
        };
      }
    },
    [pages],
  );

  // Encrypt & Upload
  const handlePrintUpload = useCallback(async () => {
    if (!printerData || pages.length === 0) return;
    setPrinting(true);
    setPrintError(null);
    setPrintSuccess(false);

    try {
      // 1. Build PDF from all pages
      const firstImg = await pageToImageData(pages[0]);
      const pdfDoc = new jsPDF({
        orientation:
          firstImg.width > firstImg.height ? "landscape" : "portrait",
        unit: "px",
        format: [firstImg.width, firstImg.height],
      });
      pdfDoc.addImage(
        firstImg.data,
        "JPEG",
        0,
        0,
        firstImg.width,
        firstImg.height,
      );

      for (let i = 1; i < pages.length; i++) {
        const imgData = await pageToImageData(pages[i]);
        pdfDoc.addPage(
          [imgData.width, imgData.height],
          imgData.width > imgData.height ? "landscape" : "portrait",
        );
        pdfDoc.addImage(
          imgData.data,
          "JPEG",
          0,
          0,
          imgData.width,
          imgData.height,
        );
      }

      const pdfArrayBuffer = pdfDoc.output("arraybuffer");

      // 2. Encrypt with AES-256-CBC + RSA-OAEP
      const publicKeyPem = printerData.printer?.encryption_public_key;
      if (!publicKeyPem) throw new Error("Printer public key not available");

      // Generate AES-256 key and IV
      const aesKey = crypto.getRandomValues(new Uint8Array(32)); // 256-bit
      const iv = crypto.getRandomValues(new Uint8Array(16)); // 128-bit IV for CBC

      // Import AES key
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        aesKey,
        { name: "AES-CBC" },
        false,
        ["encrypt"],
      );

      // Encrypt PDF with AES-256-CBC
      const encryptedPdf = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv },
        cryptoKey,
        pdfArrayBuffer,
      );

      // Import RSA public key
      const pemBody = publicKeyPem
        .replace(/-----BEGIN PUBLIC KEY-----/, "")
        .replace(/-----END PUBLIC KEY-----/, "")
        .replace(/\s/g, "");
      const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
      const rsaKey = await crypto.subtle.importKey(
        "spki",
        binaryKey,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"],
      );

      // Encrypt AES key with RSA-OAEP
      const encryptedAesKey = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        rsaKey,
        aesKey,
      );

      // Build encrypted blob: [4 bytes key length][encrypted AES key][16 bytes IV][encrypted PDF]
      const keyLenBuf = new ArrayBuffer(4);
      new DataView(keyLenBuf).setUint32(0, encryptedAesKey.byteLength, false);
      const encryptedBlob = new Blob(
        [keyLenBuf, encryptedAesKey, iv, encryptedPdf],
        { type: "application/octet-stream" },
      );

      // 3. Upload
      const formData = new FormData();
      formData.append("file", encryptedBlob, "print.enc");
      formData.append("session_id", session_id);
      formData.append("pages", String(pages.length));
      formData.append("copies", String(printSettings.copies));
      formData.append("color", String(printSettings.color));
      formData.append("duplex", String(printSettings.duplex));

      // 3. Upload encrypted file
      const uploadRes = await axiosInstance.post("/files/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const fileId = uploadRes.data?.file_id;

      // 4. Create print job to notify printer
      await axiosInstance.post(`/jobs/session/${session_id}/create`, {
        file_id: fileId,
      });

      setPrintSuccess(true);
    } catch (err: any) {
      setPrintError(
        err?.response?.data?.detail || err.message || "Print failed",
      );
    } finally {
      setPrinting(false);
    }
  }, [printerData, pages, pageToImageData, session_id, printSettings]);

  useEffect(() => {
    setLoggedIn(isAuthenticated());
  }, []);

  const handleLogout = () => {
    clearToken();
    setLoggedIn(false);
    setShowUserMenu(false);
    router.push("/login");
  };

  const requestFinished = useRef(false);
  const requestResult = useRef<{
    success: boolean;
    data?: any;
    error?: string;
  }>({ success: false });

  useEffect(() => {
    let mounted = true;
    if (!isAuthenticated()) return;
    if (!token) return;

    setShowProgress(true);
    setProgress(0);
    requestFinished.current = false;

    // Start progress animation to 90% over 2 seconds
    const startTime = Date.now();
    const animationDuration = 2000; // 2 seconds
    const targetProgress = 90;
    let progressInterval: NodeJS.Timeout;

    const handleRequestCompletion = () => {
      if (!mounted) return;

      if (requestResult.current.success) {
        // Instantly jump to 100% regardless of current progress
        setProgress(100);

        // Wait for animation to complete, then show data
        setTimeout(() => {
          if (mounted) {
            setShowProgress(false);
            setPrinterData(requestResult.current.data);
          }
        }, 300); // Match the transition duration
      } else {
        // Error - hide progress immediately without any animation
        clearInterval(progressInterval);
        setShowProgress(false);
        if (requestResult.current.error?.includes("Session not found")) {
          setSessionInvalid(requestResult.current.error);
        } else {
          setError(requestResult.current.error || "Activation failed");
        }
      }
    };

    progressInterval = setInterval(() => {
      // Always check if request finished first (handles errors after 90%)
      if (requestFinished.current) {
        clearInterval(progressInterval);
        handleRequestCompletion();
        return;
      }

      const elapsed = Date.now() - startTime;
      const progressValue = Math.min(
        (elapsed / animationDuration) * targetProgress,
        targetProgress,
      );

      if (mounted) {
        setProgress(progressValue);
      }

      // If reached 90%, keep checking but stop animating
      // Don't clear interval - keep checking for request completion
    }, 16); // ~60fps

    const activate = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await axiosInstance.post(
          `/sessions/${session_id}/activate`,
          { token },
        );

        if (!mounted) return;

        requestFinished.current = true;
        requestResult.current = { success: true, data: res.data };

        // Success will be handled by the progress interval
        // It will instantly jump to 100% from current position
      } catch (e: any) {
        if (!mounted) return;

        const status = e?.response?.status;
        const detail = e?.response?.data?.detail || e?.response?.data?.message;

        requestFinished.current = true;

        if (
          status === 404 &&
          detail ===
            "Session not found or already activated. Please scan a new QR code."
        ) {
          requestResult.current = { success: false, error: detail };
        } else {
          requestResult.current = {
            success: false,
            error: detail || e.message || "Activation failed",
          };
        }

        // Error will be handled by the progress interval
        // It will immediately hide progress and show error
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    };

    activate();

    return () => {
      mounted = false;
      clearInterval(progressInterval);
    };
  }, [session_id, token]);

  return (
    <main className="flex h-screen w-full flex-col">
      {/* Top Bar */}
      <header className="flex items-center justify-between border-b bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          {/* Session ID */}
          <div className="flex items-center gap-2 text-sm">
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
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
            <span className="font-mono text-zinc-500 dark:text-zinc-400">
              Session:
            </span>
            <span
              className="font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-45"
              title={session_id}
            >
              {session_id.length > 12
                ? `${session_id.slice(0, 12)}…`
                : session_id}
            </span>
          </div>

          {/* Info Popover */}
          {printerData && (
            <Popover open={infoOpen} onOpenChange={setInfoOpen}>
              <PopoverTrigger asChild>
                <button
                  className="inline-flex items-center justify-center h-7 w-7 rounded-full text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onMouseEnter={() => {
                    if (window.matchMedia("(hover: hover)").matches)
                      setInfoOpen(true);
                  }}
                  onMouseLeave={() => {
                    if (window.matchMedia("(hover: hover)").matches)
                      setInfoOpen(false);
                  }}
                  aria-label="Session & printer details"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4.5 w-4.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 p-0"
                onMouseEnter={() => {
                  if (window.matchMedia("(hover: hover)").matches)
                    setInfoOpen(true);
                }}
                onMouseLeave={() => {
                  if (window.matchMedia("(hover: hover)").matches)
                    setInfoOpen(false);
                }}
              >
                <div className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Session & Printer Details
                  </h3>
                  <div className="text-sm text-zinc-700 dark:text-zinc-300 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Session ID
                      </span>
                      <span className="font-mono text-xs text-end break-all">
                        {session_id}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Printer Name
                      </span>
                      <span className="font-medium">
                        {printerData.printer?.name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Printer ID
                      </span>
                      <span className="font-mono text-xs text-end">
                        {printerData.printer?.id}
                      </span>
                    </div>
                    {printerData.printer?.location && (
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 dark:text-zinc-400">
                          Location
                        </span>
                        <span>{printerData.printer.location}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        Status
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        {printerData.status}
                      </span>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Auth Controls */}
        <div className="relative flex items-center gap-3">
          {/* Pay and Print button */}
          {printerData && pages.length > 0 && (
            <button
              onClick={() => setShowPayment(true)}
              className="flex items-center gap-1.5 rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
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
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                />
              </svg>
              Pay & Print
            </button>
          )}
          {loggedIn ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center justify-center h-9 w-9 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                title="Account"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </button>
              {showUserMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-36 rounded-md border bg-white dark:bg-zinc-800 shadow-lg z-50 py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href={`/login?next=${encodeURIComponent(`/session/${session_id}${token ? `?token=${encodeURIComponent(token)}` : ""}`)}`}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="text-sm font-medium rounded-md bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700 transition-colors"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Body: content + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
          {showProgress && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8">
              <div className="w-full max-w-md space-y-4">
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    Activating Session
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                    Please wait while we connect to your printer...
                  </p>
                </div>

                <div className="space-y-2">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-center text-zinc-500 dark:text-zinc-400">
                    {Math.round(progress)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {!showProgress && error && !sessionInvalid && (
            <div className="w-full h-full flex flex-col items-center justify-center rounded-md gap-4 p-8">
              <div className="relative rounded-md bg-red-100 p-4 text-sm text-red-800 z-100 max-w-md">
                {error}
              </div>
              <div className="flex justify-center">
                <button
                  onClick={() => router.push("/")}
                  className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors"
                >
                  Scan new QR
                </button>
              </div>
            </div>
          )}

          {!showProgress && sessionInvalid && (
            <div className="w-full h-full flex flex-col items-center justify-center rounded-md gap-4 p-8">
              <div className="relative rounded-md bg-red-100 p-4 text-sm text-red-800 z-100 max-w-md">
                {sessionInvalid}
              </div>
              <div className="flex justify-center">
                <button
                  onClick={() => router.push("/")}
                  className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors"
                >
                  Scan new QR
                </button>
              </div>
            </div>
          )}

          {!showProgress && printerData && (
            <div className="w-full flex-1 flex flex-col items-center justify-center pt-8 pb-4 px-8 bg-gray-50 h-full">
              <div className="flex flex-col justify-center items-center gap-3 text-center w-full h-full">
                {pages.length > 0 ? (
                  <>
                    {selectedPage !== null && (
                      <div
                        ref={previewContainerRef}
                        id="page-preview"
                        style={{
                          aspectRatio: `1 / ${PAPER_SIZE_RATIO[printSettings.paperSize] || 1.414}`,
                        }}
                        className="w-full max-w-lg flex items-center justify-center bg-white shadow-md border overflow-hidden"
                      ></div>
                    )}

                    {/* Page thumbnails carousel */}
                    <div
                      id="pages-thumbnail"
                      className="w-full flex items-center h-24 overflow-x-auto overflow-y-hidden p-2"
                    >
                      <div className="flex flex-row items-center gap-2 mx-auto">
                        {pages.map((page, index) => (
                          <button
                            key={`${page.fileId}-${index}`}
                            onClick={() => setSelectedPage(index)}
                            className={`shrink-0 h-16 w-12 flex items-center justify-center rounded border-2 overflow-hidden transition-all ${
                              selectedPage === index
                                ? "outline-2 outline-offset-1 outline-blue-500"
                                : "border-gray-300 hover:border-gray-400"
                            } bg-white`}
                          >
                            {page.category === "image" ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={page.dataUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : page.category === "pdf" ? (
                              <span className="text-[10px] font-semibold text-red-500">
                                PDF
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-indigo-500">
                                DOC
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-12 w-12 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                      Printer Connected
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {printerData.printer?.name}
                      {printerData.printer?.location
                        ? ` — ${printerData.printer.location}`
                        : ""}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      Upload files using the sidebar to get started.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar — only show when printer is connected */}
        {!showProgress && printerData && (
          <PrintSettingsSidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((v) => !v)}
            settings={printSettings}
            onSettingsChange={setPrintSettings}
            files={uploadedFiles}
            onFilesChange={handleFilesChange}
            printerCapabilities={{
              color: printerData?.printer?.capabilities?.color ?? false,
              duplex: printerData?.printer?.capabilities?.duplex ?? false,
            }}
            onPagesChange={handlePagesChange}
            existingPageCount={pages.length}
          />
        )}
      </div>

      {/* Payment Summary Overlay */}
      {showPayment && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b">
              <button
                onClick={() => {
                  setShowPayment(false);
                  setPrintError(null);
                  setPrintSuccess(false);
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors"
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
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back
              </button>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex-1 text-center pr-10">
                Payment Summary
              </h2>
            </div>

            {/* Summary */}
            <div className="px-5 py-5 space-y-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Pages</span>
                  <span className="font-medium">{pages.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Mode</span>
                  <span className="font-medium">
                    {printSettings.color ? "Color" : "Black & White"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Copies</span>
                  <span className="font-medium">{printSettings.copies}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Double-sided</span>
                  <span className="font-medium">
                    {printSettings.duplex ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Price per page</span>
                  <span className="font-medium">
                    ₹{printSettings.color ? 2 : 1}
                  </span>
                </div>
                <div className="border-t pt-3 flex justify-between text-base">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Total
                  </span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-100">
                    ₹
                    {(printSettings.color ? 2 : 1) *
                      pages.length *
                      printSettings.copies}
                  </span>
                </div>
              </div>

              {printError && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                  {printError}
                </div>
              )}
              {printSuccess && (
                <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-700 dark:text-green-300">
                  Print job submitted successfully!
                </div>
              )}

              <button
                onClick={handlePrintUpload}
                disabled={printing || printSuccess}
                className="w-full rounded-lg bg-green-600 text-white py-3 text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {printing ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Processing…
                  </>
                ) : printSuccess ? (
                  "Submitted ✓"
                ) : (
                  "Print"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
