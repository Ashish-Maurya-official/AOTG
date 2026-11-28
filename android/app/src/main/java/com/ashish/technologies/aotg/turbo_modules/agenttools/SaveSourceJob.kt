package com.ashish.technologies.aotg.turbo_modules.agenttools

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.PersistableBundle
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.UUID

/** One explicitly requested save at a time. The OS owns the request across process death. */
class SaveSourceJob : JobService() {
    companion object {
        private const val JOB = 0x415754
        private fun prefs(c: Context) = c.getSharedPreferences("saved_web_jobs", Context.MODE_PRIVATE)
        private fun scheduler(c: Context) = requireNotNull(c.getSystemService(JobScheduler::class.java))

        @Synchronized fun enqueue(c: Context, raw: String): String {
            val url = PublicWebClient.validateUrl(raw).toString()
            require(scheduler(c).getPendingJob(JOB) == null) { "Another source is queued" }
            val token = UUID.randomUUID().toString()
            val extras = PersistableBundle().apply { putString("url", url); putString("token", token) }
            check(prefs(c).edit().putString("token", token).putString("status", "Queued").commit())
            val job = JobInfo.Builder(JOB, ComponentName(c, SaveSourceJob::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setExtras(extras).build()
            if (scheduler(c).schedule(job) != JobScheduler.RESULT_SUCCESS) {
                prefs(c).edit().remove("token").putString("status", "Could not queue source").commit()
                error("Could not queue source")
            }
            return "Queued"
        }
        @Synchronized fun clear(c: Context) {
            prefs(c).edit().clear().commit()
            scheduler(c).cancel(JOB)
            SavedSources(c).use { it.clear() }
        }
        @Synchronized fun status(c: Context): String {
            val pending = scheduler(c).getPendingJob(JOB)
            val last = prefs(c).getString("status", null) ?: "No saved sources"
            return if (pending == null && last == "Queued") "Save interrupted" else last
        }
        @Synchronized private fun finish(c: Context, token: String?, page: JSONObject?) {
            if (token == null || token != prefs(c).getString("token", null)) return
            val saved = page != null && runCatching { SavedSources(c).use { it.save(page) } }.isSuccess
            prefs(c).edit().putString("status", if (saved) "Source saved" else "Could not save this source").commit()
        }
    }
    private val web = PublicWebClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var task: Job? = null
    private var request: String? = null
    override fun onStartJob(params: JobParameters): Boolean {
        val url = params.extras.getString("url") ?: return false
        val id = UUID.randomUUID().toString()
        request = id
        web.prepare(id)
        task = scope.launch {
            withContext(Dispatchers.IO) {
                val page = runCatching { JSONObject(web.fetch(id, url)) }.getOrNull()
                ensureActive()
                finish(this@SaveSourceJob, params.extras.getString("token"), page)
            }
            jobFinished(params, false)
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        task?.cancel()
        request?.let(web::cancel)
        return true
    }
    override fun onDestroy() {
        scope.cancel()
        web.close()
        super.onDestroy()
    }
}
