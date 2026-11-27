package com.ashish.technologies.aotg.turbo_modules.liveaudio

import java.text.Normalizer

/**
 * Shared Devanagari text cleaner and Hindi number verbalizer for neural Hindi TTS
 * engines ([MmsHindiStreamingTtsEngine] and [IndicTinyHindiStreamingTtsEngine]).
 */
internal object HindiTextNormalizer {

    private val ONES_0_TO_99 = arrayOf(
        "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
        "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
        "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
        "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
        "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
        "पचास", "इक्यावन", "बावन", "तिरेपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
        "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
        "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छहत्तर", "सतहत्तर", "अठहत्तर", "उनासी",
        "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
        "नब्बे", "इक्यानबे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
    )

    private val NUMBER_PATTERN = Regex("""(?:₹\s*|Rs\.?\s*)?-?\d[\d,]*(?:\.\d+)?%?""")
    private val MARKDOWN_NOISE = Regex("""[*_`~#>]+""")
    private val MULTI_SPACE = Regex("""\s+""")

    fun normalizeForHindiTts(rawText: String): String {
        if (rawText.isBlank()) return ""
        val nfc = Normalizer.normalize(rawText, Normalizer.Form.NFC)
        val asciiDigits = convertDevanagariDigitsToAscii(nfc)
            .replace('\u0965', '।')
            .replace('|', '।')
            .replace('—', ',')
            .replace('–', ',')
            .replace(';', ',')
            .replace(':', ',')
            .replace(MARKDOWN_NOISE, " ")

        val verbalized = verbalizeNumbersAndSymbols(asciiDigits)
        val collapsed = verbalized
            .replace(MULTI_SPACE, " ")
            .trim()
        return collapsed
    }

    fun convertDevanagariDigitsToAscii(text: String): String {
        var hasDevDigit = false
        for (ch in text) {
            if (ch in '\u0966'..'\u096F') {
                hasDevDigit = true
                break
            }
        }
        if (!hasDevDigit) return text
        val sb = StringBuilder(text.length)
        for (ch in text) {
            if (ch in '\u0966'..'\u096F') {
                sb.append(('0'.code + (ch.code - 0x0966)).toChar())
            } else {
                sb.append(ch)
            }
        }
        return sb.toString()
    }

    fun integerToHindiWords(value: Long): String {
        if (value < 0L) {
            if (value == Long.MIN_VALUE) return "माइनस बहुत बड़ी संख्या"
            return "माइनस ${integerToHindiWords(-value)}"
        }
        if (value < 100L) {
            return ONES_0_TO_99[value.toInt()]
        }
        val parts = ArrayList<String>(6)
        var rem = value

        val arab = rem / 1_000_000_000L
        if (arab > 0L) {
            parts.add("${integerToHindiWords(arab)} अरब")
            rem %= 1_000_000_000L
        }
        val crore = rem / 10_000_000L
        if (crore > 0L) {
            parts.add("${integerToHindiWords(crore)} करोड़")
            rem %= 10_000_000L
        }
        val lakh = rem / 100_000L
        if (lakh > 0L) {
            parts.add("${integerToHindiWords(lakh)} लाख")
            rem %= 100_000L
        }
        val thousand = rem / 1_000L
        if (thousand > 0L) {
            parts.add("${integerToHindiWords(thousand)} हज़ार")
            rem %= 1_000L
        }
        val hundred = rem / 100L
        if (hundred > 0L) {
            parts.add("${ONES_0_TO_99[hundred.toInt()]} सौ")
            rem %= 100L
        }
        if (rem > 0L) {
            parts.add(ONES_0_TO_99[rem.toInt()])
        }
        return parts.joinToString(" ")
    }

    private fun verbalizeNumbersAndSymbols(text: String): String {
        return NUMBER_PATTERN.replace(text) { match ->
            val raw = match.value.trim()
            val isCurrency = raw.startsWith("₹") || raw.startsWith("Rs", ignoreCase = true)
            val isPercent = raw.endsWith("%")

            var numericBody = raw
                .removePrefix("₹")
                .replace(Regex("""^Rs\.?\s*""", RegexOption.IGNORE_CASE), "")
                .removeSuffix("%")
                .replace(",", "")
                .trim()

            val isNegative = numericBody.startsWith("-")
            if (isNegative) {
                numericBody = numericBody.removePrefix("-")
            }

            val spokenNumber = speakUnsignedDecimalString(numericBody)
            val prefix = if (isNegative) "माइनस " else ""
            val suffix = when {
                isPercent -> " प्रतिशत"
                isCurrency -> " रुपये"
                else -> ""
            }
            " $prefix$spokenNumber$suffix "
        }
    }

    private fun speakUnsignedDecimalString(numStr: String): String {
        val dotIdx = numStr.indexOf('.')
        val intPart = if (dotIdx >= 0) numStr.substring(0, dotIdx) else numStr
        val fracPart = if (dotIdx >= 0) numStr.substring(dotIdx + 1) else ""

        val intWords = if (intPart.isEmpty()) {
            ONES_0_TO_99[0]
        } else if (intPart.length > 1 && intPart.startsWith('0')) {
            speakDigitsIndividually(intPart)
        } else if (intPart.length > 11) {
            speakDigitsIndividually(intPart)
        } else {
            val parsed = intPart.toLongOrNull()
            if (parsed != null) integerToHindiWords(parsed) else speakDigitsIndividually(intPart)
        }

        if (fracPart.isEmpty()) return intWords
        return "$intWords दशमलव ${speakDigitsIndividually(fracPart)}"
    }

    private fun speakDigitsIndividually(digits: String): String {
        val out = ArrayList<String>(digits.length)
        for (ch in digits) {
            val d = ch.digitToIntOrNull()
            if (d != null && d in 0..9) {
                out.add(ONES_0_TO_99[d])
            }
        }
        return out.joinToString(" ")
    }
}
