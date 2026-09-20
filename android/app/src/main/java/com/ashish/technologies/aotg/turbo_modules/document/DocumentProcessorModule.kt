package com.ashish.technologies.aotg.turbo_modules.document

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Log
import com.ashish.technologies.aotg.NativeDocumentProcessorSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import org.apache.poi.extractor.ExtractorFactory
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.URLConnection
import java.util.concurrent.atomic.AtomicBoolean

class DocumentProcessorModule(
    private val reactContext: ReactApplicationContext
) : NativeDocumentProcessorSpec(reactContext) {

    companion object {
        const val NAME = "DocumentProcessor"
        private const val TAG = "DocumentProcessorModule"

        // Safety Limits
        private const val MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024L // 50 MB
        private const val MAX_PDF_PAGES = 500
        private const val MAX_OCR_PAGES = 50 // Limit expensive OCR
    }

    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val isCancelled = AtomicBoolean(false)
    private var listenerCount = 0

    init {
        // Initialize PDFBox on Android
        PDFBoxResourceLoader.init(reactContext.applicationContext)
    }

    override fun getName(): String = NAME

    override fun processDocument(filePath: String, optionsJson: String, promise: Promise) {
        isCancelled.set(false)
        val file = File(filePath)
        
        if (!file.exists()) {
            promise.resolve(createErrorResult("DOCUMENT_NOT_FOUND", "File not found at $filePath"))
            return
        }
        if (file.length() > MAX_FILE_SIZE_BYTES) {
            promise.resolve(createErrorResult("DOCUMENT_TOO_LARGE", "File exceeds 50MB limit"))
            return
        }

        coroutineScope.launch {
            try {
                val mimeType = detectMimeType(file)
                sendProgress("Detected file type: $mimeType", 0.05)

                val resultJson = when {
                    mimeType.startsWith("text/") || mimeType == "application/json" || mimeType == "text/csv" -> {
                        processPlainText(file)
                    }
                    mimeType == "message/rfc822" -> {
                        processEml(file)
                    }
                    mimeType == "application/pdf" -> {
                        processPdf(file)
                    }
                    mimeType.contains("openxmlformats-officedocument") || mimeType == "application/msword" || mimeType == "application/vnd.ms-excel" || mimeType == "application/vnd.ms-powerpoint" -> {
                        processOoxml(file, mimeType)
                    }
                    else -> {
                        createErrorResult("DOCUMENT_UNSUPPORTED", "Unsupported document type: $mimeType")
                    }
                }
                
                if (isCancelled.get()) {
                    promise.resolve(createErrorResult("DOCUMENT_CANCELLED", "Processing was cancelled"))
                } else {
                    promise.resolve(resultJson)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Document processing error", e)
                promise.resolve(createErrorResult("DOCUMENT_PROCESSING_FAILED", e.message ?: "Unknown error"))
            }
        }
    }

    override fun cancelProcessing(promise: Promise) {
        isCancelled.set(true)
        promise.resolve(true)
    }

    override fun addListener(eventName: String) {
        listenerCount++
    }

    override fun removeListeners(count: Double) {
        listenerCount -= count.toInt()
        if (listenerCount < 0) listenerCount = 0
    }

    private fun sendProgress(message: String, progress: Double) {
        if (listenerCount > 0 && reactContext.hasActiveReactInstance()) {
            val map = Arguments.createMap()
            map.putString("message", message)
            map.putDouble("progress", progress)
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("onDocumentProgress", map)
        }
    }

    private fun detectMimeType(file: File): String {
        val extension = file.extension.lowercase()
        return when (extension) {
            "pdf" -> "application/pdf"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            "doc" -> "application/msword"
            "xls" -> "application/vnd.ms-excel"
            "ppt" -> "application/vnd.ms-powerpoint"
            "eml" -> "message/rfc822"
            "msg" -> "application/vnd.ms-outlook"
            "csv" -> "text/csv"
            "json" -> "application/json"
            "txt", "md" -> "text/plain"
            "xml", "html" -> "text/html"
            else -> {
                val fromStream = URLConnection.guessContentTypeFromStream(FileInputStream(file).apply {
                    // Only read signature
                })
                fromStream ?: URLConnection.guessContentTypeFromName(file.name) ?: "application/octet-stream"
            }
        }
    }

    // --- Processors ---

    private fun processPlainText(file: File): String {
        sendProgress("Reading text file...", 0.5)
        val text = file.readText(Charsets.UTF_8) // Best effort UTF-8
        return createSuccessResult(text, "text/plain", 1)
    }

    private fun processEml(file: File): String {
        sendProgress("Parsing EML file...", 0.5)
        // Simple EML parsing (headers + body)
        val lines = file.readLines(Charsets.UTF_8)
        val extracted = java.lang.StringBuilder()
        var inBody = false
        for (line in lines) {
            if (isCancelled.get()) break
            if (!inBody && line.isBlank()) {
                inBody = true
                continue
            }
            if (!inBody && (line.startsWith("From:") || line.startsWith("To:") || line.startsWith("Subject:") || line.startsWith("Date:"))) {
                extracted.append(line).append("\n")
            } else if (inBody && !line.startsWith("--")) {
                // Heuristic to skip MIME boundaries, very rough but works for plain text bodies
                extracted.append(line).append("\n")
            }
        }
        return createSuccessResult(extracted.toString(), "message/rfc822", 1)
    }

    private fun processOoxml(file: File, mimeType: String): String {
        // Reject legacy binary formats cleanly
        if (mimeType == "application/msword" || mimeType == "application/vnd.ms-excel" || mimeType == "application/vnd.ms-powerpoint" || file.extension.lowercase() in listOf("doc", "xls", "ppt")) {
            return createErrorResult("DOCUMENT_UNSUPPORTED", "Legacy Office formats (.doc, .xls, .ppt) are not supported. Please save as .docx, .xlsx, or .pptx.")
        }
        
        sendProgress("Extracting Office document...", 0.2)
        val extracted = java.lang.StringBuilder()
        
        try {
            FileInputStream(file).use { fis ->
                ExtractorFactory.createExtractor(fis).use { extractor ->
                    val text = extractor.text
                    extracted.append(text)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "POI extraction failed", e)
            return createErrorResult("DOCUMENT_PROCESSING_FAILED", "Failed to parse Office document structure: ${e.message}")
        }
        
        return createSuccessResult(extracted.toString(), mimeType, 1)
    }

    private suspend fun processPdf(file: File): String {
        sendProgress("Opening PDF...", 0.1)
        val warnings = mutableListOf<String>()
        val extractedText = java.lang.StringBuilder()
        
        // 1. Try PDFBox for text extraction
        var pdDocument: PDDocument? = null
        val pageTextMap = mutableMapOf<Int, String>()
        var totalPages = 0
        
        try {
            pdDocument = PDDocument.load(file)
            totalPages = pdDocument.numberOfPages
            
            if (totalPages > MAX_PDF_PAGES) {
                return createErrorResult("DOCUMENT_TOO_LARGE", "PDF exceeds $MAX_PDF_PAGES pages")
            }
            
            val stripper = PDFTextStripper()
            for (i in 1..totalPages) {
                if (isCancelled.get()) break
                stripper.startPage = i
                stripper.endPage = i
                val pageText = stripper.getText(pdDocument)
                if (pageText.trim().length > 30) {
                    pageTextMap[i] = pageText
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "PDFBox extraction failed", e)
            warnings.add("Text extraction failed, falling back to OCR completely")
        } finally {
            pdDocument?.close()
        }
        
        if (isCancelled.get()) return createErrorResult("DOCUMENT_CANCELLED", "Cancelled")
        
        // 2. Fallback to OCR for pages without text
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        var ocrPagesCount = 0
        
        try {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                val renderer = PdfRenderer(pfd)
                // Use totalPages from PDFBox if available, else from renderer
                if (totalPages == 0) totalPages = renderer.pageCount
                if (totalPages > MAX_PDF_PAGES) {
                     return createErrorResult("DOCUMENT_TOO_LARGE", "PDF exceeds $MAX_PDF_PAGES pages")
                }
                
                for (i in 0 until totalPages) {
                    if (isCancelled.get()) break
                    val pageNum = i + 1
                    
                    extractedText.append("[Page $pageNum]\n")
                    
                    if (pageTextMap.containsKey(pageNum)) {
                        extractedText.append(pageTextMap[pageNum]).append("\n\n")
                    } else {
                        // Needs OCR
                        if (ocrPagesCount >= MAX_OCR_PAGES) {
                            warnings.add("OCR limit reached, skipped page $pageNum")
                            continue
                        }
                        
                        sendProgress("Scanning page $pageNum...", 0.1 + (0.9 * i / totalPages))
                        
                        val page = renderer.openPage(i)
                        // Render at ~150 DPI for good OCR without massive memory
                        val density = reactContext.resources.displayMetrics.densityDpi
                        val scale = 1.5f 
                        val width = (page.width * scale).toInt()
                        val height = (page.height * scale).toInt()
                        
                        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                        // Fill white background (PDFs are transparent)
                        bitmap.eraseColor(android.graphics.Color.WHITE)
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        page.close()
                        
                        ocrPagesCount++
                        
                        try {
                            val image = InputImage.fromBitmap(bitmap, 0)
                            val visionText = recognizer.process(image).await()
                            extractedText.append(visionText.text).append("\n\n")
                        } catch (e: Exception) {
                            Log.e(TAG, "OCR failed on page $pageNum", e)
                            warnings.add("Failed to scan page $pageNum")
                        } finally {
                            bitmap.recycle() // CRITICAL: release immediately
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "PdfRenderer failed", e)
            if (extractedText.isEmpty()) {
                return createErrorResult("DOCUMENT_PROCESSING_FAILED", "Failed to render PDF: ${e.message}")
            }
        }

        return createSuccessResult(extractedText.toString(), "application/pdf", totalPages, warnings)
    }

    // --- Helpers ---

    private fun createSuccessResult(text: String, documentType: String, pageCount: Int, warnings: List<String> = emptyList()): String {
        val json = JSONObject()
        json.put("success", true)
        json.put("text", text)
        json.put("documentType", documentType)
        json.put("pageCount", pageCount)
        json.put("charCount", text.length)
        json.put("warnings", JSONArray(warnings))
        return json.toString()
    }

    private fun createErrorResult(errorCode: String, errorMessage: String): String {
        val json = JSONObject()
        json.put("success", false)
        json.put("errorCode", errorCode)
        json.put("errorMessage", errorMessage)
        return json.toString()
    }
}
