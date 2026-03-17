"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Home() {
  const router = useRouter();
  // Camera stream & capture state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const lastQrDataRef = useRef<string | null>(null);
  const lastRedirectRef = useRef<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [qrDetected, setQrDetected] = useState(false);
  const [imageQrDetected, setImageQrDetected] = useState<boolean | null>(null);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [cameraDimensions, setCameraDimensions] = useState<{
    width: number;
    height: number;
    aspectRatio: string;
    orientation: string;
  } | null>(null);
  const [scanDimensions, setScanDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const checkAndRedirect = (data: string) => {
    // UUID regex pattern
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Check if data matches the pattern: /session/{uuid}?token={anything}
    const sessionPattern =
      /^\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\?token=(.+)$/i;
    const match = data.match(sessionPattern);

    if (match) {
      const sessionId = match[1];
      const token = match[2];
      console.log("Valid session QR detected:", { sessionId, token });
      // Require user to be authenticated before redirecting
      const isAuth =
        typeof window !== "undefined" &&
        Boolean(localStorage.getItem("authToken"));
      if (!isAuth) {
        router.push(`/login?next=${encodeURIComponent(data)}`);
        return false;
      }
      router.push(data);
      return true;
    }

    // Also try to parse as URL and extract the path
    try {
      const url = new URL(data);
      const pathMatch = url.pathname.match(
        /^\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      const tokenParam = url.searchParams.get("token");

      if (pathMatch && tokenParam) {
        const redirectPath = url.pathname + url.search;
        console.log(
          "Valid session URL detected, redirecting to:",
          redirectPath,
        );
        const isAuth =
          typeof window !== "undefined" &&
          Boolean(localStorage.getItem("authToken"));
        if (!isAuth) {
          router.push(`/login?next=${encodeURIComponent(redirectPath)}`);
          return false;
        }
        router.push(redirectPath);
        return true;
      }
    } catch (error) {
      // Not a valid URL, that's okay
    }

    return false;
  };

  const logQrData = (data: string, source: "video" | "image") => {
    // Always log for debugging
    if (lastQrDataRef.current !== data) {
      lastQrDataRef.current = data;
      console.log(`QR data (${source}):`, data);
    }

    // Only redirect once per unique QR code to avoid multiple redirects
    if (lastRedirectRef.current !== data) {
      const redirected = checkAndRedirect(data);
      if (redirected) {
        lastRedirectRef.current = data;
      }
    }
  };

  const scanImageData = (imageData: ImageData, source: "video" | "image") => {
    // (debug logs removed)

    const attempt = (
      data: Uint8ClampedArray,
      w: number,
      h: number,
      label: string,
    ) => {
      const res = jsQR(data, w, h, { inversionAttempts: "attemptBoth" });
      if (res?.data) {
        console.log(`jsQR found (orientation=${label})`, { data: res.data });
        logQrData(res.data, source);
        return res;
      }
      return null;
    };

    // Try the original orientation first
    const orig = attempt(
      imageData.data,
      imageData.width,
      imageData.height,
      "orig",
    );
    if (orig) return orig;

    // If not found, try rotated variants (common with some mobile cameras)
    const rotate90 = (input: ImageData) => {
      const w = input.width;
      const h = input.height;
      const out = new Uint8ClampedArray(input.data.length);
      // rotate 90deg clockwise: (x,y) -> (y, w-1-x)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcIdx = (y * w + x) * 4;
          const dstX = y;
          const dstY = w - 1 - x;
          const dstIdx = (dstY * h + dstX) * 4; // note swapped dims
          out[dstIdx] = input.data[srcIdx];
          out[dstIdx + 1] = input.data[srcIdx + 1];
          out[dstIdx + 2] = input.data[srcIdx + 2];
          out[dstIdx + 3] = input.data[srcIdx + 3];
        }
      }
      return { data: out, width: h, height: w };
    };

    try {
      let rotated = rotate90(imageData);
      const r90 = attempt(rotated.data, rotated.width, rotated.height, "90");
      if (r90) return r90;

      // 180 = rotate90 of rotated
      rotated = rotate90(
        new ImageData(rotated.data, rotated.width, rotated.height),
      );
      const r180 = attempt(rotated.data, rotated.width, rotated.height, "180");
      if (r180) return r180;

      // 270
      rotated = rotate90(
        new ImageData(rotated.data, rotated.width, rotated.height),
      );
      const r270 = attempt(rotated.data, rotated.width, rotated.height, "270");
      if (r270) return r270;
    } catch (e) {
      console.warn("Rotation attempts failed", e);
    }

    // nothing found
    return null;
  };

  const drawQrOutline = (location: any) => {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video || !location) return;

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    // Match the overlay canvas pixel size to the displayed video size and device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = video.clientWidth || video.videoWidth;
    const displayHeight = video.clientHeight || video.videoHeight;

    overlay.width = Math.round(displayWidth * dpr);
    overlay.height = Math.round(displayHeight * dpr);
    overlay.style.width = `${displayWidth}px`;
    overlay.style.height = `${displayHeight}px`;

    // Clear previous drawings
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Map video-space coordinates to overlay pixel coordinates
    const scaleX = overlay.width / (video.videoWidth || displayWidth);
    const scaleY = overlay.height / (video.videoHeight || displayHeight);

    const tlx = location.topLeftCorner.x * scaleX;
    const tly = location.topLeftCorner.y * scaleY;
    const trx = location.topRightCorner.x * scaleX;
    const try_ = location.topRightCorner.y * scaleY;
    const brx = location.bottomRightCorner.x * scaleX;
    const bry = location.bottomRightCorner.y * scaleY;
    const blx = location.bottomLeftCorner.x * scaleX;
    const bly = location.bottomLeftCorner.y * scaleY;

    // Draw the QR code outline (on high-DPI canvas)
    ctx.beginPath();
    ctx.moveTo(tlx, tly);
    ctx.lineTo(trx, try_);
    ctx.lineTo(brx, bry);
    ctx.lineTo(blx, bly);
    ctx.closePath();
    ctx.lineWidth = Math.max(2, 6 * dpr);
    ctx.strokeStyle = "#00FF00";
    ctx.stroke();

    // Add a semi-transparent fill to make it more visible
    ctx.fillStyle = "rgba(0, 255, 0, 0.08)";
    ctx.fill();
  };

  const clearQrOutline = () => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
  };

  const scanDataUrl = async (dataUrl: string, source: "image") => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    const imageLoaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image."));
    });
    img.src = dataUrl;

    try {
      await imageLoaded;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = scanImageData(imageData, source);
      setImageQrDetected(Boolean(result));
      setQrDetected(Boolean(result));
    } catch (scanError) {
      setError(
        `Unable to scan image: ${scanError instanceof Error ? scanError.message : "Unknown error"}.`,
      );
    }
  };

  const resetUploadInput = () => {
    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  };

  // Enumerate available cameras
  const enumerateCameras = async () => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("mediaDevices API not available");
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(
        (device) => device.kind === "videoinput",
      );
      setAvailableCameras(videoDevices);

      // Set default camera (prefer back camera)
      if (videoDevices.length > 0 && !selectedCameraId) {
        const backCamera = videoDevices.find(
          (device) =>
            device.label.toLowerCase().includes("back") ||
            device.label.toLowerCase().includes("rear") ||
            device.label.toLowerCase().includes("environment"),
        );
        setSelectedCameraId(backCamera?.deviceId || videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error("Error enumerating cameras:", err);
    }
  };

  // Start camera
  const startCamera = async () => {
    setError("");
    setCapturedImage(null);
    setUploadedImage(null);
    lastQrDataRef.current = null;
    lastRedirectRef.current = null;
    setImageQrDetected(null);

    // Check if mediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(
        "Camera access is not available. This feature requires HTTPS or localhost. Please ensure you're accessing the site securely.",
      );
      return;
    }

    // Set camera active first to ensure video element is rendered
    setCameraActive(true);

    // Wait a bit for React to render the video element
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      let stream: MediaStream | null = null;

      // Use selected camera if available, otherwise try back camera
      const constraints: MediaStreamConstraints = {
        video: selectedCameraId
          ? {
              deviceId: { exact: selectedCameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current && stream) {
        const video = videoRef.current;

        // Set up video element properties
        video.setAttribute("playsinline", "true");
        video.muted = true;
        video.autoplay = true;

        // Set the stream first
        video.srcObject = stream;

        // Log and store video dimensions once metadata is loaded
        video.onloadedmetadata = () => {
          const dimensions = {
            width: video.videoWidth,
            height: video.videoHeight,
            aspectRatio: (video.videoWidth / video.videoHeight).toFixed(2),
            orientation:
              video.videoHeight > video.videoWidth ? "portrait" : "landscape",
          };
          setCameraDimensions(dimensions);
          console.log("Camera initialized:", dimensions);
        };

        // Try to play
        try {
          await video.play();
        } catch (playError) {
          // Try to play again after a short delay
          setTimeout(() => {
            video.play().catch(() => {});
          }, 100);
        }
      }
    } catch (e) {
      setError(
        `Unable to access camera: ${e instanceof Error ? e.message : "Unknown error"}. Please allow camera permissions or try another device.`,
      );
      setCameraActive(false);
    }
  };

  // Stop camera
  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setCameraDimensions(null);
    setScanDimensions(null);
  };

  // Capture current video frame to image
  const captureFrame = () => {
    setError("");
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    setCapturedImage(dataUrl);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = scanImageData(imageData, "image");
    setImageQrDetected(Boolean(result));
    setQrDetected(Boolean(result));
  };

  // Handle file upload (images only)
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    setCapturedImage(null);
    setUploadedImage(null);
    lastQrDataRef.current = null;
    lastRedirectRef.current = null;
    setImageQrDetected(null);

    // Always stop camera when uploading a file
    if (cameraActive) {
      stopCamera();
    }

    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Only image files are allowed.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setUploadedImage(result);
      scanDataUrl(result, "image");
    };
    reader.readAsDataURL(file);
    resetUploadInput();
  };

  // Handle upload button click (to ensure camera stops even if no file selected)
  const handleUploadClick = () => {
    setError("");
    setCapturedImage(null);
    setUploadedImage(null);
    lastQrDataRef.current = null;
    lastRedirectRef.current = null;
    setImageQrDetected(null);
    resetUploadInput();

    // Stop camera when switching to upload mode
    if (cameraActive) {
      stopCamera();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enumerate cameras on mount
  useEffect(() => {
    enumerateCameras();
  }, []);

  // Restart camera when selected camera changes (only if camera is active)
  useEffect(() => {
    if (cameraActive && selectedCameraId) {
      stopCamera();
      // Small delay to ensure camera is fully stopped before restarting
      setTimeout(() => {
        startCamera();
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCameraId]);

  useEffect(() => {
    if (!cameraActive) {
      setQrDetected(false);
      clearQrOutline();
    }
  }, [cameraActive]);

  useEffect(() => {
    if (!cameraActive) return;

    let timeoutId: NodeJS.Timeout | null = null;
    let isScanning = false;
    let isMounted = true;

    const scanFrame = () => {
      if (!isMounted || isScanning) {
        if (isMounted) {
          timeoutId = setTimeout(scanFrame, 250);
        }
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        timeoutId = setTimeout(scanFrame, 250);
        return;
      }

      if (
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        timeoutId = setTimeout(scanFrame, 250);
        return;
      }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        timeoutId = setTimeout(scanFrame, 250);
        return;
      }

      isScanning = true;

      try {
        // Scale down the frame for faster, more robust scanning (then map back)
        const MAX_SCAN_WIDTH = 480;
        const vidW = video.videoWidth;
        const vidH = video.videoHeight;

        const scale = Math.min(1, MAX_SCAN_WIDTH / vidW);
        const scanW = Math.max(320, Math.floor(vidW * scale));
        const scanH = Math.floor((vidH * scanW) / vidW);

        canvas.width = scanW;
        canvas.height = scanH;

        // Keep showing the original video dimensions in the UI
        if (
          !scanDimensions ||
          scanDimensions.width !== vidW ||
          scanDimensions.height !== vidH
        ) {
          setScanDimensions({ width: vidW, height: vidH });
        }

        // Enable smoothing for better QR detection on scaled frames
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        // Draw a scaled video frame to the canvas for scanning
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, scanW, scanH);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // (debug logs removed)
        const result = scanImageData(imageData, "video");
        if (result?.location) {
          // Map location from scan (canvas) coordinates back to video coordinates
          const mapPt = (pt: { x: number; y: number }) => ({
            x: Math.round(pt.x * (vidW / canvas.width)),
            y: Math.round(pt.y * (vidH / canvas.height)),
          });

          const mappedLocation = {
            topLeftCorner: mapPt(result.location.topLeftCorner),
            topRightCorner: mapPt(result.location.topRightCorner),
            bottomRightCorner: mapPt(result.location.bottomRightCorner),
            bottomLeftCorner: mapPt(result.location.bottomLeftCorner),
          };

          setQrDetected(true);
          console.log("QR Code detected!", {
            data: result.data,
            position: `x:${mappedLocation.topLeftCorner.x}, y:${mappedLocation.topLeftCorner.y}`,
            videoSize: `${vidW}x${vidH}`,
            scanSize: `${canvas.width}x${canvas.height}`,
          });
          drawQrOutline(mappedLocation);
        } else {
          setQrDetected(false);
          clearQrOutline();
        }
      } catch (scanError) {
        setError(
          `Unable to scan video frame: ${scanError instanceof Error ? scanError.message : "Unknown error"}.`,
        );
      } finally {
        isScanning = false;
        if (isMounted) {
          timeoutId = setTimeout(scanFrame, 250);
        }
      }
    };

    // Add delay for initial scan to let camera fully initialize
    timeoutId = setTimeout(scanFrame, 300);

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [cameraActive]);

  return (
    <div className="min-h-screen w-full bg-zinc-50 text-black dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-6 py-12">
        <h1 className="text-3xl font-bold">Xerox Kiosk Machine</h1>
        <p className="text-center text-zinc-700 dark:text-zinc-300">
          Scan the QR from the machine to print.
        </p>

        {/* Camera selector */}
        {availableCameras.length > 1 && (
          <div className="w-full">
            <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Select Camera
            </label>
            <Select
              value={selectedCameraId}
              onValueChange={setSelectedCameraId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a camera" />
              </SelectTrigger>
              <SelectContent>
                {availableCameras.map((camera) => (
                  <SelectItem key={camera.deviceId} value={camera.deviceId}>
                    {camera.label ||
                      `Camera ${availableCameras.indexOf(camera) + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex w-full flex-col gap-4 sm:flex-row">
          <Button
            className="h-12 flex-1"
            variant={cameraActive ? "default" : "default"}
            onClick={cameraActive ? captureFrame : startCamera}
          >
            {cameraActive ? "Capture QR Image" : "Scan QR with Camera"}
          </Button>

          <Button
            className="h-12 flex-1"
            variant={uploadedImage ? "default" : "outline"}
            onClick={() => uploadInputRef.current?.click()}
            asChild={false}
          >
            <span onClick={handleUploadClick}>
              Upload QR Image
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={uploadInputRef}
                onChange={onFileChange}
              />
            </span>
          </Button>
        </div>

        {error && (
          <div className="w-full rounded-md bg-red-100 p-3 text-sm text-red-700 dark:bg-red-900/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Camera preview */}
        {cameraActive && !uploadedImage && (
          <div className="w-full">
            <div className="relative">
              <video
                ref={videoRef}
                className="w-full object-contain rounded-lg border border-black/10 dark:border-white/10"
                playsInline
                muted
                autoPlay
              />
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute left-0 top-0 h-full w-full rounded-lg"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div
                className={`h-3 w-3 rounded-full ${qrDetected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`}
              ></div>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {qrDetected ? "✓ QR detected" : "Scanning..."}
              </span>
            </div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {qrDetected
                ? "QR code found! Hold steady for automatic redirect."
                : "Point camera at QR code or tap Capture."}
            </div>
            {cameraDimensions && (
              <div className="mt-2 space-y-1">
                <div className="rounded-md bg-zinc-100 dark:bg-zinc-800 p-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  📷 Camera: {cameraDimensions.width}×{cameraDimensions.height}{" "}
                  • {cameraDimensions.orientation}
                </div>
                {scanDimensions && (
                  <div className="rounded-md bg-blue-100 dark:bg-blue-900/30 p-2 text-xs font-mono text-blue-700 dark:text-blue-300">
                    🔍 Scanning: {scanDimensions.width}×{scanDimensions.height}
                  </div>
                )}
              </div>
            )}
            <Button variant="outline" className="mt-3" onClick={stopCamera}>
              Stop Camera
            </Button>
          </div>
        )}

        {/* Preview of captured or uploaded image */}
        {(capturedImage || uploadedImage) && (
          <div className="w-full">
            <h2 className="mb-2 text-lg font-semibold">
              {capturedImage ? "Captured QR Image" : "Uploaded QR Image"}
            </h2>
            <img
              src={capturedImage || uploadedImage || ""}
              alt="QR preview"
              className="max-h-80 w-full rounded-lg border border-black/10 object-contain dark:border-white/10"
            />
            {imageQrDetected !== null && (
              <div className="mt-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                {imageQrDetected ? "QR detected" : "No QR detected"}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCapturedImage(null);
                  setUploadedImage(null);
                  setImageQrDetected(null);
                  resetUploadInput();
                }}
              >
                Clear Image
              </Button>
              {uploadedImage && (
                <Button onClick={startCamera}>Use Camera Instead</Button>
              )}
            </div>
          </div>
        )}

        {/* Hidden canvas used for capture */}
        <canvas ref={canvasRef} className="hidden" />
      </main>
    </div>
  );
}
