package com.ashish.technologies.aotg.turbo_modules.agenttools

import android.app.Activity
import android.app.Dialog
import android.util.Base64
import android.webkit.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.bridge.ReactApplicationContext
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import org.jsoup.Jsoup

/** Execute a bounded snapshot in a visible, offline WebView with an opaque origin. */
internal object RenderedPage {
    suspend fun read(context: ReactApplicationContext, activity: Activity, url: String, web: PublicWebClient, id: String): String {
        val page = JSONObject(web.fetch(id, url, forRendering = true))
        val base = page.getString("url")
        val doc = Jsoup.parse(page.getString("html"), base)
        page.remove("html")
        doc.select("base,meta[http-equiv=refresh],iframe,frame,object,embed,link,form input,textarea").remove()
        var remaining = 3
        for (script in doc.select("script[src]")) {
            currentCoroutineContext().ensureActive()
            val target = runCatching { PublicWebClient.validateUrl(script.absUrl("src")) }.getOrNull()
            if (target == null || target.host != PublicWebClient.validateUrl(base).host || remaining <= 0) {
                script.remove()
                continue
            }
            remaining--
            web.prepare(id)
            val js = runCatching { web.fetch(id, target.toString(), script = true) }.getOrNull()
            if (js == null) script.remove() else {
                val encoded = Base64.encodeToString(js.toByteArray(), Base64.NO_WRAP)
                script.attr("src", "data:text/javascript;base64,$encoded")
            }
        }
        doc.head().prependElement("meta").attr("http-equiv", "Content-Security-Policy")
            .attr("content", "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'")
        val html = doc.outerHtml()
        return withContext(Dispatchers.Main.immediate) {
            fun foreground() = context.lifecycleState == LifecycleState.RESUMED && !activity.isFinishing && !activity.isDestroyed
            check(foreground())
            val view = WebView(activity)
            val dialog = Dialog(activity)
            try {
                view.settings.apply {
                    javaScriptEnabled = true
                    blockNetworkLoads = true
                    allowFileAccess = false
                    allowContentAccess = false
                    domStorageEnabled = false
                    cacheMode = WebSettings.LOAD_NO_CACHE
                }
                val loaded = CompletableDeferred<Unit>()
                view.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest) = true
                    override fun onPageFinished(v: WebView, address: String) { loaded.complete(Unit) }
                    override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                        loaded.cancel()
                        dialog.dismiss()
                        return true
                    }
                }
                dialog.setTitle(PublicWebClient.validateUrl(base).host)
                dialog.setContentView(view)
                dialog.show()
                view.loadData(Base64.encodeToString(html.toByteArray(), Base64.NO_WRAP), "text/html", "base64")
                withTimeout(5000) {
                    while (!loaded.isCompleted) { check(dialog.isShowing && foreground()); delay(100) }
                    loaded.await()
                    var previous = ""
                    var stable = 0
                    while (true) {
                        check(dialog.isShowing && foreground())
                        val snapshot = CompletableDeferred<String>()
                        view.evaluateJavascript("JSON.stringify({title:document.title.slice(0,200),text:(document.body?.innerText||'').slice(0,64001)})") { snapshot.complete(it ?: "null") }
                        val data = JSONObject(JSONTokener(snapshot.await()).nextValue() as String)
                        val body = data.getString("text")
                        stable = if (body == previous && body.trim().length >= 80) stable + 1 else 0
                        if (stable >= 2) {
                            page.put("text", body.take(64000)).put("truncated", body.length > 64000)
                                .put("title", data.getString("title")).put("links", JSONArray())
                            break
                        }
                        previous = body
                        delay(250)
                    }
                }
                page.toString()
            } finally {
                dialog.dismiss()
                (view.parent as? android.view.ViewGroup)?.removeView(view)
                view.destroy()
            }
        }
    }
}
