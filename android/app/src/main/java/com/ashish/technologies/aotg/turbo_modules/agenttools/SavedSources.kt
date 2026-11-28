package com.ashish.technologies.aotg.turbo_modules.agenttools

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

internal class SavedSources(context: Context) : SQLiteOpenHelper(context, "saved_sources.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sources (id INTEGER PRIMARY KEY, url TEXT UNIQUE, title TEXT, fetched TEXT)")
        db.execSQL("CREATE VIRTUAL TABLE chunks USING fts4(source_id, body, notindexed=source_id, tokenize=unicode61)")
    }
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) = Unit

    fun save(page: JSONObject) {
        val body = page.getString("text").trim()
        require(page.getBoolean("canStore") && body.length >= 80)
        require(!Regex("^(just a moment|access denied|verify you are human|attention required)", RegexOption.IGNORE_CASE)
            .containsMatchIn(page.getString("title")))
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("sources", "url=?", arrayOf(page.getString("url")))
            val row = db.insertOrThrow("sources", null, ContentValues().apply {
                put("url", page.getString("url"))
                put("title", page.getString("title"))
                put("fetched", page.getString("fetchedAt"))
            })
            // Delete orphaned chunks before inserting: SQLite can reuse a deleted row ID.
            db.delete("chunks", "source_id=? OR CAST(source_id AS INTEGER) NOT IN (SELECT id FROM sources)", arrayOf(row.toString()))
            body.chunked(1200).forEach { chunk ->
                db.insertOrThrow("chunks", null, ContentValues().apply { put("source_id", row); put("body", chunk) })
            }
            db.execSQL("DELETE FROM sources WHERE id NOT IN (SELECT id FROM sources ORDER BY id DESC LIMIT 32)")
            db.execSQL("DELETE FROM chunks WHERE CAST(source_id AS INTEGER) NOT IN (SELECT id FROM sources)")
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun clear() {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("chunks", null, null)
            db.delete("sources", null, null)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun search(query: String): String {
        val terms = Regex("[\\p{L}\\p{M}\\p{N}]+").findAll(query.take(300)).map { it.value }.distinct().take(10).toList()
        val result = JSONArray()
        if (terms.isEmpty()) return result.toString()
        val match = terms.joinToString(" OR ") { "\"" + it + "\"" }
        readableDatabase.rawQuery("SELECT s.url,s.title,s.fetched,c.body FROM chunks c JOIN sources s ON s.id=c.source_id WHERE c.body MATCH ? ORDER BY s.id DESC,c.docid LIMIT 20", arrayOf(match)).use {
            while (it.moveToNext()) result.put(JSONObject().put("url", it.getString(0)).put("title", it.getString(1))
                .put("fetchedAt", it.getString(2)).put("text", it.getString(3)))
        }
        return result.toString()
    }
}
