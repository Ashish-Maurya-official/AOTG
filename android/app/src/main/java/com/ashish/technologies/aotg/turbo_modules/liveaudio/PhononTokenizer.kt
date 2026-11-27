package com.ashish.technologies.aotg.turbo_modules.liveaudio

import java.io.ByteArrayOutputStream
import java.io.File
import org.json.JSONObject

/**
 * SentencePiece Unigram tokenizer with `<0xXX>` UTF-8 byte fallback matching
 * `gradium/phonon-31m-en` (`tokenizer.json`).
 */
internal class PhononTokenizer(
    private val vocabPieces: Array<String>,
    private val vocabScores: DoubleArray,
    private val unkId: Int,
    private val byteFallback: Boolean,
    private val specialIds: Set<Int>
) {
    private class TrieNode {
        val children = HashMap<Int, TrieNode>()
        var tokenId: Int = -1
    }

    private sealed interface ViterbiPiece {
        data class Token(val id: Int) : ViterbiPiece
        data class Unk(val bytes: ByteArray) : ViterbiPiece
    }

    companion object {
        private const val UNK_PENALTY = 10.0
        private const val SPACE = '\u2581'
        private val BYTE_TOKEN_REGEX = Regex("^<0x([0-9A-F]{2})>$")

        fun fromFile(file: File): PhononTokenizer {
            val root = JSONObject(file.readText(Charsets.UTF_8))
            val model = root.getJSONObject("model")
            val type = model.optString("type")
            require(type == "Unigram") { "Unsupported Phonon tokenizer model type: $type" }

            val unkId = model.optInt("unk_id", 0)
            val byteFallback = model.optBoolean("byte_fallback", true)
            val vocabArr = model.getJSONArray("vocab")
            val size = vocabArr.length()
            val pieces = Array(size) { "" }
            val scores = DoubleArray(size)

            for (i in 0 until size) {
                val entry = vocabArr.getJSONArray(i)
                pieces[i] = entry.getString(0)
                scores[i] = entry.getDouble(1)
            }

            val specialIds = HashSet<Int>()
            val added = root.optJSONArray("added_tokens")
            if (added != null) {
                for (i in 0 until added.length()) {
                    val obj = added.optJSONObject(i) ?: continue
                    if (obj.optBoolean("special", false)) {
                        specialIds.add(obj.optInt("id"))
                    }
                }
            }

            return PhononTokenizer(pieces, scores, unkId, byteFallback, specialIds)
        }
    }

    private val pieceToId = HashMap<String, Int>(vocabPieces.size * 2)
    private val root = TrieNode()
    private val unkScore: Double
    private val byteFallbackIds = IntArray(256) { -1 }

    init {
        var minScore = Double.POSITIVE_INFINITY
        for (id in vocabPieces.indices) {
            val piece = vocabPieces[id]
            pieceToId[piece] = id
            val s = vocabScores[id]
            if (s < minScore) minScore = s

            var node = root
            for (b in piece.toByteArray(Charsets.UTF_8)) {
                val key = b.toInt() and 0xFF
                node = node.children.getOrPut(key) { TrieNode() }
            }
            node.tokenId = id
        }
        unkScore = (if (minScore.isInfinite()) 0.0 else minScore) - UNK_PENALTY

        for (b in 0..255) {
            val hex = "<0x${b.toString(16).uppercase().padStart(2, '0')}>"
            byteFallbackIds[b] = pieceToId[hex] ?: -1
        }
    }

    fun encode(text: String): IntArray {
        if (text.isEmpty()) return IntArray(0)
        val spaced = "$SPACE$text".replace(' ', SPACE)
        val out = ArrayList<Int>(spaced.length + 4)

        var start = 0
        for (i in 1 until spaced.length) {
            if (spaced[i] == SPACE) {
                val segment = spaced.substring(start, i)
                if (segment.isNotEmpty()) {
                    encodeSegment(segment.toByteArray(Charsets.UTF_8), out)
                }
                start = i
            }
        }
        if (start < spaced.length) {
            val tail = spaced.substring(start)
            if (tail.isNotEmpty()) {
                encodeSegment(tail.toByteArray(Charsets.UTF_8), out)
            }
        }

        return IntArray(out.size) { out[it] }
    }

    fun decode(ids: IntArray): String {
        val parts = StringBuilder()
        val byteBuf = ByteArrayOutputStream()
        var isFirst = true

        fun flushBytes() {
            if (byteBuf.size() > 0) {
                parts.append(String(byteBuf.toByteArray(), Charsets.UTF_8))
                byteBuf.reset()
            }
        }

        for (id in ids) {
            if (specialIds.contains(id)) continue
            val piece = if (id in vocabPieces.indices) vocabPieces[id] else ""
            val text = if (isFirst) {
                piece.replace(SPACE.toString(), "")
            } else {
                piece.replace(SPACE, ' ')
            }
            isFirst = false

            val byteMatch = BYTE_TOKEN_REGEX.matchEntire(text)
            if (byteMatch != null) {
                val byteVal = byteMatch.groupValues[1].toInt(16)
                byteBuf.write(byteVal)
            } else {
                flushBytes()
                parts.append(text)
            }
        }
        flushBytes()
        return parts.toString()
    }

    private fun utf8CharLen(firstByte: Int): Int {
        val u = firstByte and 0xFF
        return when {
            u < 0x80 -> 1
            u < 0xE0 -> 2
            u < 0xF0 -> 3
            else -> 4
        }
    }

    private fun encodeSegment(bytes: ByteArray, out: MutableList<Int>) {
        val pieces = viterbi(bytes)
        for (p in pieces) {
            when (p) {
                is ViterbiPiece.Token -> out.add(p.id)
                is ViterbiPiece.Unk -> {
                    if (byteFallback) {
                        var allMapped = true
                        for (b in p.bytes) {
                            if (byteFallbackIds[b.toInt() and 0xFF] < 0) {
                                allMapped = false
                                break
                            }
                        }
                        if (allMapped) {
                            for (b in p.bytes) {
                                out.add(byteFallbackIds[b.toInt() and 0xFF])
                            }
                        } else {
                            out.add(unkId)
                        }
                    } else {
                        out.add(unkId)
                    }
                }
            }
        }
    }

    private fun viterbi(bytes: ByteArray): List<ViterbiPiece> {
        val size = bytes.size
        val bestScore = DoubleArray(size + 1)
        val bestStart = IntArray(size + 1) { -1 }
        val bestToken = IntArray(size + 1)

        fun offer(at: Int, from: Int, id: Int, s: Double) {
            if (bestStart[at] >= 0 && s <= bestScore[at]) return
            bestScore[at] = s
            bestStart[at] = from
            bestToken[at] = id
        }

        var at = 0
        while (at < size) {
            val base = bestScore[at]
            val step = minOf(utf8CharLen(bytes[at].toInt()), size - at)
            var matchedSingle = false
            var node: TrieNode? = root

            for (end in at until size) {
                node = node?.children?.get(bytes[end].toInt() and 0xFF) ?: break
                val id = node.tokenId
                if (id < 0) continue
                offer(end + 1, at, id, vocabScores[id] + base)
                if (end + 1 - at == step) {
                    matchedSingle = true
                }
            }
            if (!matchedSingle) {
                offer(at + step, at, unkId, unkScore + base)
            }
            at += step
        }

        val reversed = ArrayList<ViterbiPiece>()
        val fused = ByteArrayOutputStream()
        var end = size
        while (end > 0) {
            val s = bestStart[end]
            if (s < 0 || s >= end) break
            val tok = bestToken[end]
            if (tok == unkId) {
                for (i in end - 1 downTo s) {
                    fused.write(bytes[i].toInt() and 0xFF)
                }
            } else {
                if (fused.size() > 0) {
                    reversed.add(ViterbiPiece.Unk(fused.toByteArray().reversedArray()))
                    fused.reset()
                }
                reversed.add(ViterbiPiece.Token(tok))
            }
            end = s
        }
        if (fused.size() > 0) {
            reversed.add(ViterbiPiece.Unk(fused.toByteArray().reversedArray()))
        }
        return reversed.asReversed()
    }
}
