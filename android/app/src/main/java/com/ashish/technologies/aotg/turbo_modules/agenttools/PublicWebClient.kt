package com.ashish.technologies.aotg.turbo_modules.agenttools

import okhttp3.Call
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.Proxy
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** Public HTTPS transport. DNS is checked by the same resolver used to connect. */
internal class PublicWebClient {
    companion object {
        const val MAX_BYTES = 2 * 1024 * 1024
        const val MAX_TEXT_CHARS = 64000

        // Stop consuming nested/overlapping DOM blocks once evidence is full.
        // Joining everything first can amplify a small nested page into a huge string.
        fun boundedJoin(parts: Sequence<String>, separator: String): String = buildString {
            for (part in parts) {
                if (isNotEmpty()) append(separator.take(MAX_TEXT_CHARS + 1 - length))
                append(part.take(MAX_TEXT_CHARS + 1 - length))
                if (length > MAX_TEXT_CHARS) break
            }
        }
        fun isPublicAddress(address: InetAddress): Boolean {
            if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
                address.isSiteLocalAddress || address.isMulticastAddress) return false
            val bytes = address.address.map { it.toInt() and 255 }
            if (bytes.size == 4) {
                return !(bytes[0] == 0 || bytes[0] == 10 || bytes[0] == 127 || bytes[0] >= 224 ||
                    (bytes[0] == 100 && bytes[1] in 64..127) ||
                    (bytes[0] == 169 && bytes[1] == 254) ||
                    (bytes[0] == 172 && bytes[1] in 16..31) ||
                    (bytes[0] == 192 && (bytes[1] == 168 || bytes[1] == 0 || bytes[1] == 2)) ||
                    (bytes[0] == 198 && (bytes[1] in 18..19 || bytes[1] == 51)) ||
                    (bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113))
            }
            // Only globally routed IPv6 unicast; reject ULA, mapped, translation and special ranges.
            return bytes.size == 16 && bytes[0] in 0x20..0x3f &&
                !(bytes[0] == 0x20 && bytes[1] == 0x01 && (bytes[2] < 2 || (bytes[2] == 0x0d && bytes[3] == 0xb8))) &&
                !(bytes[0] == 0x20 && bytes[1] == 0x02)
        }

        fun validateUrl(raw: String): HttpUrl {
            require(raw.length <= 2048) { "URL too long" }
            val url = raw.toHttpUrl()
            require(url.isHttps && url.port == 443 && url.username.isEmpty() && url.password.isEmpty()) { "Only public HTTPS URLs are supported" }
            require(url.host.contains('.') || url.host.contains(':')) { "Public host required" }
            require(!url.host.endsWith(".local") && !url.host.endsWith(".localhost") && !url.host.endsWith(".internal")) { "Private host blocked" }
            if (url.host.contains(':') || url.host.matches(Regex("[0-9.]+"))) {
                require(isPublicAddress(InetAddress.getByName(url.host))) { "Private destination blocked" }
            }
            return url
        }
    }

    private val client = OkHttpClient.Builder()
        .proxy(Proxy.NO_PROXY)
        .dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val addresses = Dns.SYSTEM.lookup(hostname)
                require(addresses.isNotEmpty() && addresses.all(::isPublicAddress)) { "Private destination blocked" }
                return addresses
            }
        })
        .followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(18, TimeUnit.SECONDS).build()
    private val active = ConcurrentHashMap<String, Call>()
    private val registered = ConcurrentHashMap.newKeySet<String>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()
    private val slots = Semaphore(2)

    fun cancel(id: String) {
        if (!registered.contains(id)) return
        cancelled.add(id)
        active[id]?.cancel()
    }

    fun close() {
        registered.forEach(::cancel)
        client.connectionPool.evictAll()
    }

    fun prepare(id: String) {
        require(id.length <= 100 && registered.size < 8 && registered.add(id)) { "Duplicate or excessive request" }
    }

    fun fetch(id: String, raw: String, forRendering: Boolean = false, script: Boolean = false): String {
        val acquired = slots.tryAcquire()
        try {
            require(acquired) { "Too many concurrent requests" }
            var url = validateUrl(raw)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
            repeat(6) { redirect ->
                check(!cancelled.contains(id) && System.nanoTime() < deadline) { "Request cancelled or timed out" }
                val call = client.newCall(Request.Builder().url(url)
                    .header("User-Agent", "AOTG/1.0 (user-initiated page reader)")
                    .header("Accept", "text/html,application/xhtml+xml,application/json,text/plain,application/rss+xml,application/atom+xml")
                    .header("Cache-Control", "no-cache")
                    .build())
                active[id] = call
                if (cancelled.contains(id)) call.cancel()
                call.timeout().timeout(maxOf(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)
                call.execute().use { response ->
                    if (response.code in listOf(301, 302, 303, 307, 308)) {
                        require(redirect < 5) { "Too many redirects" }
                        url = validateUrl(url.resolve(response.header("Location") ?: error("Invalid redirect"))?.toString() ?: error("Invalid redirect"))
                        return@repeat
                    }
                    require(response.isSuccessful) { "Source unavailable (${response.code})" }
                    val body = response.body ?: error("Empty response")
                    val mime = body.contentType()?.let { "${it.type}/${it.subtype}" } ?: ""
                    if (script) require(mime in setOf("text/javascript", "application/javascript"))
                    else require(mime in setOf("text/html", "application/xhtml+xml", "application/json", "text/plain", "application/rss+xml", "application/atom+xml", "text/xml", "application/xml")) { "Unsupported content type" }
                    require(body.contentLength() <= MAX_BYTES) { "Response too large" }
                    val bytes = ByteArrayOutputStream()
                    body.byteStream().use { stream ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            check(!cancelled.contains(id) && System.nanoTime() < deadline) { "Request cancelled or timed out" }
                            val count = stream.read(buffer)
                            if (count < 0) break
                            require(bytes.size() + count <= MAX_BYTES) { "Response too large" }
                            bytes.write(buffer, 0, count)
                        }
                    }
                    val html = bytes.toString(body.contentType()?.charset(Charsets.UTF_8)?.name() ?: "UTF-8")
                    if (script) {
                        require(url.host == validateUrl(raw).host && html.length <= 256000)
                        return html
                    }
                    val result = JSONObject().put("url", url.toString()).put("mimeType", mime)
                        .put("canStore", !response.cacheControl.noStore && !response.cacheControl.isPrivate)
                        .put("fetchedAt", java.time.Instant.now().toString())
                    if (forRendering) {
                        require(mime == "text/html" || mime == "application/xhtml+xml")
                        require(html.length <= 512000 && html.count { it == '<' } <= 10000)
                        return result.put("html", html).toString()
                    }
                    if (mime == "application/json" || mime == "text/plain") {
                        return result.put("title", url.host).put("text", html.take(MAX_TEXT_CHARS)).put("links", JSONArray())
                            .put("truncated", html.length > MAX_TEXT_CHARS).toString()
                    }
                    require(html.count { it == '<' } <= 10000) { "Page markup is too complex" }
                    val document = Jsoup.parse(html, url.toString())
                    // Some sites wrap the entire article in a form. Keep its text, never its controls.
                    document.select("script,style,noscript,iframe,svg,canvas,input,button,textarea,select,[hidden],[aria-hidden=true],nav,footer").remove()
                    val root = document.selectFirst("article") ?: document.selectFirst("main") ?: document.body()
                    val blocks = root.select("h1,h2,h3,h4,p,li,pre,blockquote,tr,entry,item")
                    val text = if (blocks.isEmpty()) root.text() else boundedJoin(blocks.asSequence().map { element ->
                        if (element.tagName() == "tr") boundedJoin(element.select("th,td").asSequence().map { it.text() }, " | ") else element.text()
                    }, "\n\n")
                    val links = JSONArray()
                    document.select("a[href],link[href]").asSequence().mapNotNull { element ->
                        runCatching { validateUrl(element.absUrl("href")) }.getOrNull()?.let { target ->
                            JSONObject().put("url", target.toString()).put("title", element.text().take(160))
                        }
                    }.distinctBy { it.getString("url") }.take(25).forEach { links.put(it) }
                    check(!cancelled.contains(id) && System.nanoTime() < deadline) { "Request cancelled or timed out" }
                    return result.put("title", document.title().take(200)).put("text", text.take(MAX_TEXT_CHARS))
                        .put("links", links).put("truncated", text.length > MAX_TEXT_CHARS).toString()
                }
            }
            error("Too many redirects")
        } finally {
            active.remove(id)
            cancelled.remove(id)
            registered.remove(id)
            if (acquired) slots.release()
        }
    }
}
