package com.ashish.technologies.aotg.turbo_modules.liveaudio

import kotlin.math.abs
import kotlin.math.ceil

internal data class PhononPreparedPrompt(
    val text: String,
    val framesAfterEos: Int
)

internal data class PhononChunkPlan(
    val text: String,
    val tokens: IntArray,
    val framesAfterEos: Int,
    val frameBudget: Int
)

/**
 * English text normalizer, prompt preparer, and frame-budget chunk planner
 * matching `gradium/phonon-31m-en` (`slicc-ortllama/src/phonon/text.js`).
 */
internal object PhononTextNormalizer {
    private const val MAX_TOKENS_PER_CHUNK = 50
    private const val MAX_FIT_TOKENS = 200
    private const val PUNCTUATION = "!?.:,;\u2026"
    private const val CLOSERS = "\"')]\u201D\u2019\u00BB"

    private val DIGITS = arrayOf(
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"
    )
    private val SCALES = arrayOf(
        1_000_000_000L to "billion",
        1_000_000L to "million",
        1_000L to "thousand"
    )
    private val CURRENCIES = mapOf(
        '$' to ("dollar" to "dollars"),
        '\u20AC' to ("euro" to "euros"),
        '\u00A3' to ("pound" to "pounds"),
        '\u00A5' to ("yen" to "yen"),
        '\u00A2' to ("cent" to "cents")
    )
    private val SCALE_SUFFIXES = listOf(
        "thousand" to "thousand",
        "million" to "million",
        "billion" to "billion",
        "trillion" to "trillion",
        "bn" to "billion",
        "BN" to "billion",
        "mn" to "million",
        "tn" to "trillion",
        "k" to "thousand",
        "K" to "thousand",
        "m" to "million",
        "M" to "million",
        "b" to "billion",
        "B" to "billion"
    )
    private val SCALE_WORDS = setOf("thousand", "million", "billion", "trillion")
    private val SLASH_UNITS = setOf(
        "km", "kg", "mg", "ml", "mL", "dL", "mol", "kJ", "kW", "kWh", "Hz",
        "min", "hr", "hrs", "sec", "ft", "lb", "lbs", "oz", "mi", "mph",
        "kph", "yd", "cm", "mm", "yr", "wk", "mo", "kcal", "rpm"
    )
    private val ABBREVIATIONS = mapOf(
        "Lt" to "Lieutenant",
        "Lt." to "Lieutenant",
        "Col." to "Colonel",
        "Sgt." to "Sergeant",
        "Sgt" to "Sergeant",
        "Capt." to "Captain",
        "Cpl." to "Corporal",
        "Gen." to "General",
        "Adm." to "Admiral",
        "Sen." to "Senator",
        "Sens." to "Senators",
        "Rep." to "Representative",
        "Reps." to "Representatives",
        "Gov." to "Governor",
        "Pres." to "President",
        "Det." to "Detective",
        "Insp." to "Inspector",
        "Supt." to "Superintendent",
        "Ft." to "Fort",
        "Mt." to "Mount",
        "Jan." to "January",
        "Feb." to "February",
        "Mar." to "March",
        "Apr." to "April",
        "Jun." to "June",
        "Jul." to "July",
        "Aug." to "August",
        "Sep." to "September",
        "Sept." to "September",
        "Oct." to "October",
        "Nov." to "November",
        "Dec." to "December",
        "Mon." to "Monday",
        "Tue." to "Tuesday",
        "Tues." to "Tuesday",
        "Wed." to "Wednesday",
        "Thu." to "Thursday",
        "Thur." to "Thursday",
        "Thurs." to "Thursday",
        "Fri." to "Friday",
        "Sat." to "Saturday",
        "Sun." to "Sunday",
        "vol." to "volume",
        "Vol." to "Volume",
        "ed." to "edition",
        "approx." to "approximately",
        "Approx." to "Approximately",
        "dept." to "department",
        "Dept." to "Department",
        "vs." to "versus",
        "w/" to "with",
        "W/" to "With",
        "w/o" to "without",
        "W/o" to "Without"
    )
    private val GREEK = arrayOf(
        "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
        "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi",
        "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega"
    )
    private val SYMBOLS = mapOf(
        '\u00D7' to "times",
        '\u00F7' to "divided by",
        '\u2264' to "less than or equal to",
        '\u2265' to "greater than or equal to",
        '\u2260' to "is not equal to",
        '\u2248' to "approximately",
        '\u221A' to "square root of",
        '\u221E' to "infinity",
        '\u2211' to "sigma",
        '\u2030' to "per mille"
    )
    private val SUBSCRIPTS = mapOf(
        '\u2080' to "0", '\u2081' to "1", '\u2082' to "2", '\u2083' to "3", '\u2084' to "4",
        '\u2085' to "5", '\u2086' to "6", '\u2087' to "7", '\u2088' to "8", '\u2089' to "9",
        '\u208A' to "+", '\u208B' to "-", '\u2090' to "a", '\u2091' to "e", '\u2092' to "o",
        '\u2093' to "x", '\u2095' to "h", '\u2096' to "k", '\u2097' to "l", '\u2098' to "m",
        '\u2099' to "n", '\u209A' to "p", '\u209B' to "s", '\u209C' to "t", '\u1D62' to "i",
        '\u2C7C' to "j"
    )
    private val SUPERSCRIPTS = mapOf(
        '\u2070' to "0", '\u00B9' to "1", '\u00B2' to "2", '\u00B3' to "3", '\u2074' to "4",
        '\u2075' to "5", '\u2076' to "6", '\u2077' to "7", '\u2078' to "8", '\u2079' to "9",
        '\u207B' to "-", '\u207A' to "+", '\u207F' to "n"
    )
    private val DOUBLE_QUOTES = "\u00BB\u00AB\u2039\u203A\u201C\u201D\u201E\u201F\u2033\u2036\u2E42\u275D\u275E\u2760\u301D\u301E\u301F\uFF02".toSet()
    private val SINGLE_QUOTES = "\u2018\u2019\u201A\u201B\u2032\u2035\u275B\u275C\u275F\uFF07\u02BC\u02BB\u02B9\u00B4`".toSet()
    private val SPACERS = "\u2013*\u2014[]{}".toSet()
    private val BULLETS = "\u2022\u2023\u25E6\u00B7\u2192\u2190\u2191\u2193\u27A1\u279C".toSet()
    private val DASHES = "\u2010\u2011\u2012\u2015".toSet()
    private val EMAIL_USER = mapOf('-' to "dash", '.' to "dot", '+' to "plus", '_' to "underscore")
    private val COMMON_TLDS = setOf(
        "com", "org", "net", "edu", "gov", "mil", "int", "io", "ai", "co", "uk", "de",
        "fr", "jp", "cn", "au", "ca", "us", "in", "nl", "es", "it", "br", "ch", "se",
        "no", "dev", "app", "tech", "info", "biz", "me", "tv", "xyz", "cloud", "gg",
        "fm", "ly", "to", "sh", "so", "is", "uk", "eu", "cc"
    )
    private val FOLD_MAP: Map<Char, Char> by lazy {
        val raw =
            "\u00CCI\u00D2O\u00DDY\u00ECi\u00F2o\u00FDy\u00FFy\u0100A\u0101a\u0102A\u0103a\u0104A\u0105a\u0106C\u0107c" +
            "\u0108C\u0109c\u010AC\u010Bc\u010CC\u010Dc\u010ED\u010Fd\u0112E\u0113e\u0114E\u0115e\u0116E\u0117e" +
            "\u0118E\u0119e\u011AE\u011Be\u011CG\u011Dg\u011EG\u011Fg\u0120G\u0121g\u0122G\u0123g\u0124H\u0125h" +
            "\u0128I\u0129i\u012AI\u012Bi\u012CI\u012Di\u012EI\u012Fi\u0130I\u0134J\u0135j\u0136K\u0137k\u0139L" +
            "\u013Al\u013BL\u013Cl\u013DL\u013El\u0143N\u0144n\u0145N\u0146n\u0147N\u0148n\u014CO\u014Do\u014EO" +
            "\u014Fo\u0150O\u0151o\u0154R\u0155r\u0156R\u0157r\u0158R\u0159r\u015AS\u015Bs\u015CS\u015Ds\u015ES" +
            "\u015Fs\u0160S\u0161s\u0162T\u0163t\u0164T\u0165t\u0168U\u0169u\u016AU\u016Bu\u016CU\u016Du\u016EU" +
            "\u016Fu\u0170U\u0171u\u0172U\u0173u\u0174W\u0175w\u0176Y\u0177y\u0178Y\u0179Z\u017Az\u017BZ\u017Cz" +
            "\u017DZ\u017Ez\u01A0O\u01A1o\u01AFU\u01B0u\u01CDA\u01CEa\u01CFI\u01D0i\u01D1O\u01D2o\u01D3U\u01D4u" +
            "\u01D5U\u01D6u\u01D7U\u01D8u\u01D9U\u01DAu\u01DBU\u01DCu\u01DEA\u01DFa\u01E0A\u01E1a\u01E6G\u01E7g" +
            "\u01E8K\u01E9k\u01EAO\u01EBb\u01ECO\u01EDo\u01F0j\u01F4G\u01F5g\u01F8N\u01F9n\u01FAA\u01FBa\u0200A" +
            "\u0201a\u0202A\u0203a\u0204E\u0205e\u0206E\u0207e\u0208I\u0209i\u020AI\u020Bi\u020CO\u020Do\u020EO" +
            "\u020Fo\u0210R\u0211r\u0212R\u0213r\u0214U\u0215u\u0216U\u0217u\u0218S\u0219s\u021AT\u021Bt\u021EH" +
            "\u021Fh\u0226A\u0227a\u0228E\u0229e\u022AO\u022Bo\u022CO\u022Do\u022EO\u022Fo\u0230O\u0231o\u0232Y" +
            "\u0233y\u1E00A\u1E01a\u1E02B\u1E03b\u1E04B\u1E05b\u1E06B\u1E07b\u1E08C\u1E09c\u1E0AD\u1E0Bd\u1E0CD" +
            "\u1E0Dd\u1E0ED\u1E0Fd\u1E10D\u1E11d\u1E12D\u1E13d\u1E14E\u1E15e\u1E16E\u1E17e\u1E18E\u1E19e\u1E1AE" +
            "\u1E1Be\u1E1CE\u1E1De\u1E1EF\u1E1Ff\u1E20G\u1E21g\u1E22H\u1E23h\u1E24H\u1E25h\u1E26H\u1E27h\u1E28H" +
            "\u1E29h\u1E2AH\u1E2Bh\u1E2CI\u1E2Di\u1E2EI\u1E2Fi\u1E30K\u1E31k\u1E32K\u1E33k\u1E34K\u1E35k\u1E36L" +
            "\u1E37l\u1E38L\u1E39l\u1E3AL\u1E3Bl\u1E3CL\u1E3Dl\u1E3EM\u1E3Fm\u1E40M\u1E41m\u1E42M\u1E43m\u1E44N" +
            "\u1E45n\u1E46N\u1E47n\u1E48N\u1E49n\u1E4AN\u1E4Bn\u1E4CO\u1E4Do\u1E4EO\u1E4Fo\u1E50O\u1E51o\u1E52O" +
            "\u1E53o\u1E54P\u1E55p\u1E56P\u1E57p\u1E58R\u1E59r\u1E5AR\u1E5Br\u1E5CR\u1E5Dr\u1E5ER\u1E5Fr\u1E60S" +
            "\u1E61s\u1E62S\u1E63s\u1E64S\u1E65s\u1E66S\u1E67s\u1E68S\u1E69s\u1E6AT\u1E6Bt\u1E6CT\u1E6Dt\u1E6ET" +
            "\u1E6Ft\u1E70T\u1E71t\u1E72U\u1E73u\u1E74U\u1E75u\u1E76U\u1E77u\u1E78U\u1E79u\u1E7AU\u1E7Bu\u1E7CV" +
            "\u1E7Dv\u1E7EV\u1E7Fv\u1E80W\u1E81w\u1E82W\u1E83w\u1E84W\u1E85w\u1E86W\u1E87w\u1E88W\u1E89w\u1E8AX" +
            "\u1E8Bx\u1E8CX\u1E8Dx\u1E8EY\u1E8Fy\u1E90Z\u1E91z\u1E92Z\u1E93z\u1E94Z\u1E95z\u1E96h\u1E97t\u1E98w" +
            "\u1E99y\u1EA0A\u1EA1a\u1EA2A\u1EA3a\u1EA4A\u1EA5a\u1EA6A\u1EA7a\u1EA8A\u1EA9a\u1EAAA\u1EABa\u1EACA" +
            "\u1EADa\u1EAEA\u1EAFa\u1EB0A\u1EB1a\u1EB2A\u1EB3a\u1EB4A\u1EB5a\u1EB6A\u1EB7a\u1EB8E\u1EB9e\u1EBAE" +
            "\u1EBBe\u1EBCE\u1EBDe\u1EBEE\u1EBFe\u1EC0E\u1EC1e\u1EC2E\u1EC3e\u1EC4E\u1EC5e\u1EC6E\u1EC7e\u1EC8I" +
            "\u1EC9i\u1ECAI\u1ECBi\u1ECCO\u1ECDo\u1ECEO\u1ECFo\u1ED0O\u1ED1o\u1ED2O\u1ED3o\u1ED4O\u1ED5o\u1ED6O" +
            "\u1ED7o\u1ED8O\u1ED9o\u1EDAO\u1EDBo\u1EDCO\u1EDDo\u1EDEO\u1EDFo\u1EE0O\u1EE1o\u1EE2O\u1EE3o\u1EE4U" +
            "\u1EE5u\u1EE6U\u1EE7u\u1EE8U\u1EE9u\u1EEAU\u1EEBu\u1EECU\u1EEDu\u1EEEU\u1EEFu\u1EF0U\u1EF1u\u1EF2Y" +
            "\u1EF3y\u1EF4Y\u1EF5y\u1EF6Y\u1EF7y\u1EF8Y\u1EF9y"
        val map = HashMap<Char, Char>(raw.length / 2)
        var i = 0
        while (i + 1 < raw.length) {
            map[raw[i]] = raw[i + 1]
            i += 2
        }
        map['\u01EB'] = 'o'
        map
    }

    private fun isAsciiPunct(c: Char): Boolean {
        val code = c.code
        return (code in 33..47) || (code in 58..64) || (code in 91..96) || (code in 123..126)
    }

    private fun isDigitChar(c: Char): Boolean = c in '0'..'9'
    private fun allDigits(s: String): Boolean = s.isNotEmpty() && s.all { it in '0'..'9' }
    private fun isWhitespaceChar(c: Char): Boolean = Character.isWhitespace(c)
    private fun isAlnum(c: Char): Boolean = Character.isLetterOrDigit(c)

    private fun isEmojiCp(cp: Int): Boolean =
        (cp in 0x1F000..0x1FAFF) ||
            (cp in 0x2600..0x27BF) ||
            (cp in 0x2B00..0x2BFF) ||
            cp == 0xFE0F ||
            cp == 0x200D

    private class Appender {
        private val buf = StringBuilder()

        fun last(): Char? = if (buf.isEmpty()) null else buf[buf.length - 1]

        private fun keeps(last: Char): Boolean {
            if (last in "\"'@+%#&") return true
            return last == '$' && buf.length >= 2 && buf[buf.length - 2] in '0'..'9'
        }

        fun push(c: Char) {
            if (c == '.' || c == ',') {
                while (buf.isNotEmpty()) {
                    val l = buf[buf.length - 1]
                    val remove = Character.isWhitespace(l) || (isAsciiPunct(l) && !keeps(l))
                    if (!remove) break
                    buf.deleteCharAt(buf.length - 1)
                }
            }
            buf.append(c)
        }

        fun pushStr(s: String) {
            for (ch in s) push(ch)
        }

        fun pushWhitespace() {
            val l = last()
            if (buf.isNotEmpty() && (l == null || !Character.isWhitespace(l))) {
                push(' ')
            }
        }

        fun popWhitespace() {
            while (buf.isNotEmpty() && Character.isWhitespace(buf[buf.length - 1])) {
                buf.deleteCharAt(buf.length - 1)
            }
        }

        fun popLast() {
            if (buf.isNotEmpty()) buf.deleteCharAt(buf.length - 1)
        }

        fun pushSpoken(word: String) {
            pushWhitespace()
            pushStr(word)
            pushWhitespace()
        }

        fun endsWithOne(): Boolean {
            var n = buf.length
            while (n > 0 && Character.isWhitespace(buf[n - 1])) n--
            if (n <= 0 || buf[n - 1] != '1') return false
            val before = if (n >= 2) buf[n - 2] else null
            return before == null || !(before in '0'..'9' || before == '.' || before == ',')
        }

        fun endsWithN(): Boolean {
            val len = if (last() == '.') buf.length - 1 else buf.length
            if (len <= 0) return false
            val l = buf[len - 1]
            if (l != 'n' && l != 'N') return false
            val prev = if (len >= 2) buf[len - 2] else null
            return prev == null || !Character.isLetterOrDigit(prev)
        }

        fun endsWithSpacedDigit(): Boolean {
            val l = last() ?: return false
            if (!Character.isWhitespace(l)) return false
            for (i in buf.length - 1 downTo 0) {
                if (!Character.isWhitespace(buf[i])) {
                    return buf[i] in '0'..'9'
                }
            }
            return false
        }

        override fun toString(): String {
            popWhitespace()
            return buf.toString()
        }
    }

    private fun trimEndPunct(s: String, pred: (Char) -> Boolean): String {
        var end = s.length
        while (end > 0 && pred(s[end - 1])) end--
        return s.substring(0, end)
    }

    private fun splitSuffix(word: String): Pair<String, String> {
        val body = trimEndPunct(word) { it in PUNCTUATION }
        return body to word.substring(body.length)
    }

    private fun isPunctSuffix(rest: String): String? =
        if (rest.all { it in PUNCTUATION }) rest else null

    private fun greekName(cp: Int): String? {
        val idx = when {
            cp in 0x3B1..0x3C1 -> cp - 0x3B1
            cp == 0x3C2 -> 17
            cp in 0x3C3..0x3C9 -> cp - 0x3B1 - 1
            cp in 0x391..0x3A1 -> cp - 0x391
            cp in 0x3A3..0x3A9 -> cp - 0x391 - 1
            else -> -1
        }
        return if (idx in GREEK.indices) GREEK[idx] else null
    }

    private fun spell(s: String): String =
        s.filter { it != '-' }.map { c ->
            if (c in '0'..'9') DIGITS[c - '0'] else c.toString()
        }.joinToString(" ")

    private fun spellShort(word: String): String {
        if (word.equals("www", ignoreCase = true)) return "W-W-W"
        if (word.length == 2 && word.all { it.code < 128 }) {
            return "${word[0].uppercaseChar()}-${word[1].uppercaseChar()}"
        }
        return word
    }

    private fun rangeWords(body: String): String? {
        val dash = body.indexOf('-')
        if (dash < 0) return null
        val from = body.substring(0, dash)
        val to = body.substring(dash + 1)
        val small = { s: String -> s.length in 2..3 && allDigits(s) && !s.startsWith('0') }
        val year = { s: String -> s.length == 4 && allDigits(s) && (s.startsWith("1") || s.startsWith("20")) }
        val ok = when {
            small(from) && small(to) -> from.toInt() < to.toInt()
            from.length == 4 && to.length == 4 -> year(from) && year(to) && from < to
            from.length == 4 && to.length == 2 -> year(from) && allDigits(to) && from.substring(2) < to
            else -> false
        }
        return if (ok) "$from to $to" else null
    }

    private fun numberWords(word: String): Pair<String, String>? {
        if (word.isEmpty()) return null
        if (word.length >= 2 && word[0] == '0' && word[1] in '0'..'9') return null
        val negative = word.startsWith('-')
        var rest = if (negative) word.substring(1) else word
        val endIdx = rest.indexOfFirst { it !in '0'..'9' && it != ',' }.let { if (it < 0) rest.length else it }
        val intPart = trimEndPunct(rest.substring(0, endIdx)) { it == ',' }
        if (intPart.isEmpty()) return null
        rest = rest.substring(intPart.length)
        var decimal: String? = null
        if (rest.startsWith('.')) {
            val after = rest.substring(1)
            val n = after.indexOfFirst { it !in '0'..'9' }.let { if (it < 0) after.length else it }
            if (n > 0) {
                decimal = after.substring(0, n)
                rest = after.substring(n)
            }
        }
        val tail = isPunctSuffix(rest) ?: return null
        val digitsOnly = intPart.filter { it in '0'..'9' }
        val value = digitsOnly.toLongOrNull() ?: return null
        if (value >= 1_000_000_000_000L) return null

        var words = if (value < 1000L || value in 1900L..2099L) {
            value.toString()
        } else {
            val parts = ArrayList<String>(4)
            for ((div, name) in SCALES) {
                val group = (value / div) % 1000L
                if (group > 0) parts.add("$group $name")
            }
            val rem = value % 1000L
            if (rem > 0) parts.add(rem.toString())
            parts.joinToString(" ")
        }
        if (decimal != null) words = "$words point $decimal"
        if (negative) words = "minus $words"
        return words to tail
    }

    private fun rewriteNumbers(word: String): String? {
        val (body, end) = splitSuffix(word)
        if (body.length >= 2 && body.startsWith('0') && allDigits(body)) return "${spell(body)}$end"
        rangeWords(body)?.let { return "$it$end" }
        numberWords(word)?.let { (w, t) -> return "$w$t" }
        val dash = word.indexOf('-')
        if (dash < 0) return null
        val head = word.substring(0, dash)
        val tail = word.substring(dash)
        if (tail.length < 2 || !Character.isLetter(tail[1])) return null
        val parsed = numberWords(head) ?: return null
        return if (parsed.second.isEmpty()) "${parsed.first}$tail" else null
    }

    private fun withScale(amount: String, scale: String, symbol: Char): String? {
        val read = numberWords(amount) ?: return null
        if (read.second.isNotEmpty()) return null
        val many = CURRENCIES[symbol]?.second ?: return null
        return "${read.first} $scale $many"
    }

    private fun withCents(amount: String, symbol: Char): String? {
        val dot = amount.lastIndexOf('.')
        if (dot < 0) return null
        val whole = amount.substring(0, dot)
        val cents = amount.substring(dot + 1)
        val grouped = whole.split(',').let { parts ->
            parts.withIndex().all { (idx, g) ->
                allDigits(g) && if (idx == 0) g.length <= 3 else g.length == 3
            }
        }
        if (!(allDigits(whole) || grouped)) return null
        if (cents.length != 2 || !allDigits(cents)) return null
        val read = numberWords(whole) ?: return null
        val (one, many) = CURRENCIES[symbol] ?: return null
        val units = "${read.first} ${if (read.first == "1") one else many}"
        if (cents == "00") return units
        val spokenCents = if (cents.startsWith('0')) cents.substring(1) else cents
        return if (read.first == "0") "$spokenCents cents" else "$units and $spokenCents cents"
    }

    private fun rewriteCurrency(word: String): String? {
        val (body, end) = splitSuffix(word)
        if (body.startsWith('-') && body.length >= 2 && CURRENCIES.containsKey(body[1])) {
            return rewriteCurrency("${body[1]}-${body.substring(2)}$end")
        }
        if (body.length < 2) return null
        val split = when {
            CURRENCIES.containsKey(body[0]) -> body[0] to body.substring(1)
            CURRENCIES.containsKey(body.last()) -> body.last() to body.dropLast(1)
            else -> return null
        }
        val (sym, amount) = split
        for ((suffixEnd, scaleName) in SCALE_SUFFIXES) {
            if (amount.endsWith(suffixEnd) && amount.length > suffixEnd.length &&
                amount[amount.length - suffixEnd.length - 1] in '0'..'9'
            ) {
                val base = amount.substring(0, amount.length - suffixEnd.length)
                val spoken = withScale(base, scaleName, sym) ?: break
                return "$spoken$end"
            }
        }
        if (sym != '\u00A2') {
            withCents(amount, sym)?.let { return "$it$end" }
        }
        val read = numberWords(amount) ?: return null
        val (one, many) = CURRENCIES[sym] ?: return null
        val name = if (sym == '\u00A2' && amount == "1") one else many
        return "${read.first} $name$end"
    }

    private fun rewriteDashedDigits(word: String): String? {
        val (body, end) = splitSuffix(word)
        if (!body.all { it in '0'..'9' || it == '-' || it == '_' }) return null
        if (body.count { it == '-' || it == '_' } < 2) return null
        val groups = ArrayList<Pair<String, Char?>>()
        var start = 0
        for (i in body.indices) {
            if (body[i] == '-' || body[i] == '_') {
                if (i == start) return null
                groups.add(body.substring(start, i) to body[i])
                start = i + 1
            }
        }
        if (start == body.length) return null
        groups.add(body.substring(start) to null)
        if (!body.contains('_') && groups.size == 3) {
            val a = groups[0].first
            val b = groups[1].first
            val c = groups[2].first
            fun dayMonth(x: String, y: String): Boolean {
                if (x.length > 2 || y.length > 2) return false
                val nx = x.toIntOrNull() ?: return false
                val ny = y.toIntOrNull() ?: return false
                return (nx in 1..31 && ny in 1..12) || (nx in 1..12 && ny in 1..31)
            }
            if ((a.length == 4 && dayMonth(b, c)) || ((c.length == 4 || c.length == 2) && dayMonth(a, b))) {
                return null
            }
        }
        val words = ArrayList<String>()
        for ((g, sep) in groups) {
            if (g.length >= 4) {
                for (ch in g) words.add(ch.toString())
            } else {
                words.add(g)
            }
            if (sep == '_') words.add("underscore")
        }
        return "${words.joinToString(" ")}$end"
    }

    private fun speakParts(part: String, out: MutableList<String>, mapper: (Char) -> String?) {
        var start = 0
        for (i in part.indices) {
            val mapped = mapper(part[i]) ?: continue
            if (start < i) out.add(part.substring(start, i))
            out.add(mapped)
            start = i + 1
        }
        if (start < part.length) out.add(part.substring(start))
    }

    private fun rewriteEmail(word: String): String? {
        val at = word.indexOf('@')
        if (at <= 0) return null
        val user = word.substring(0, at)
        if (!user.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it in "._+-" }) return null
        val afterAt = word.substring(at + 1)
        val firstLen = afterAt.indexOfFirst {
            !(it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-')
        }.let { if (it < 0) afterAt.length else it }
        if (firstLen == 0) return null
        val labels = ArrayList<String>()
        labels.add(afterAt.substring(0, firstLen))
        var rest = afterAt.substring(firstLen)
        while (rest.startsWith('.')) {
            val sub = rest.substring(1)
            val n = sub.indexOfFirst {
                !(it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-')
            }.let { if (it < 0) sub.length else it }
            if (n == 0) break
            labels.add(sub.substring(0, n))
            rest = sub.substring(n)
        }
        val end = isPunctSuffix(rest) ?: return null
        if (labels.size < 2) return null
        val tld = labels.removeAt(labels.lastIndex)
        val words = ArrayList<String>()
        speakParts(user, words) { EMAIL_USER[it] }
        words.add("at")
        labels.forEachIndexed { idx, l ->
            if (idx > 0) words.add("dot")
            speakParts(l, words) { if (it == '-') "dash" else null }
        }
        words.add("dot")
        return "${words.joinToString(" ")} ${spellShort(tld)}$end"
    }

    private fun rewriteUrl(word: String): String? {
        val words = ArrayList<String>()
        var rest = word
        when {
            rest.startsWith("https://") -> {
                words.addAll(listOf("H-T-T-P-S", "colon", "slash", "slash"))
                rest = rest.substring(8)
            }
            rest.startsWith("http://") -> {
                words.addAll(listOf("H-T-T-P", "colon", "slash", "slash"))
                rest = rest.substring(7)
            }
        }
        val scheme = words.isNotEmpty()
        fun takeWhile(s: String, pred: (Char) -> Boolean): Pair<String, String>? {
            var n = 0
            while (n < s.length && pred(s[n])) n++
            return if (n > 0) s.substring(0, n) to s.substring(n) else null
        }
        val labelPred = { c: Char -> isAlnum(c) || c == '-' }
        val first = takeWhile(rest, labelPred) ?: return null
        val labels = ArrayList<String>()
        labels.add(first.first)
        rest = first.second
        while (rest.startsWith('.')) {
            val next = takeWhile(rest.substring(1), labelPred) ?: break
            labels.add(next.first)
            rest = next.second
        }
        val path = takeWhile(rest) { labelPred(it) || it == '/' }
        if (path != null) rest = path.second
        val end = isPunctSuffix(rest) ?: return null
        val tld = labels.last()
        if (labels.size < 2 || !COMMON_TLDS.contains(tld.lowercase())) return null
        val hasMixedCase = tld.any { it.isUpperCase() } && tld.any { it.isLowerCase() }
        if (hasMixedCase && !scheme && !labels[0].equals("www", ignoreCase = true)) return null

        fun speakUrlPart(part: String) {
            var start = 0
            for (i in part.indices) {
                val w = when {
                    part[i] == '-' -> "dash"
                    part[i] == '/' -> "slash"
                    isDigitChar(part[i]) -> part[i].toString()
                    else -> null
                } ?: continue
                if (start < i) words.add(spellShort(part.substring(start, i)))
                words.add(w)
                start = i + 1
            }
            if (start < part.length) words.add(spellShort(part.substring(start)))
        }

        labels.forEachIndexed { idx, l ->
            if (idx > 0) words.add("dot")
            speakUrlPart(l)
        }
        if (path != null) speakUrlPart(path.first)
        return "${words.joinToString(" ")}$end"
    }

    private fun rewriteAbbreviation(word: String): String? {
        val (body, end) = splitSuffix(word)
        val dotted = end.startsWith('.')
        val short = if (dotted) word.substring(0, body.length + 1) else body
        val expansion = ABBREVIATIONS[short] ?: return null
        return "$expansion${if (dotted) end.substring(1) else end}"
    }

    private fun rewriteElongation(word: String): String? {
        val (body, end) = splitSuffix(word)
        if (body.length < 3 || !body.all { it in 'a'..'z' || it in 'A'..'Z' }) return null
        if (body.all { it in 'A'..'Z' }) return null
        val stretched = { c: Char -> c.lowercaseChar() in "aeiouyhw" }
        var hasTriple = false
        for (i in 0..body.length - 3) {
            if (body[i] == body[i + 1] && body[i + 1] == body[i + 2] && stretched(body[i])) {
                hasTriple = true
                break
            }
        }
        if (!hasTriple) return null
        val out = StringBuilder(body.length)
        for (i in body.indices) {
            val c = body[i]
            val repeat = i >= 1 && body[i - 1] == c && stretched(c)
            val lo = maxOf(0, i - 2)
            val hi = minOf(body.length, i + 3)
            var tripleNear = false
            for (k in lo..hi - 3) {
                if (body[k] == c && body[k + 1] == c && body[k + 2] == c) {
                    tripleNear = true
                    break
                }
            }
            if (!(repeat && tripleNear)) out.append(c)
        }
        return "$out$end"
    }

    private fun rewriteWord(word: String): String? =
        rewriteNumbers(word)
            ?: rewriteCurrency(word)
            ?: rewriteDashedDigits(word)
            ?: rewriteEmail(word)
            ?: rewriteUrl(word)
            ?: rewriteAbbreviation(word)
            ?: rewriteElongation(word)

    private fun rewriteAll(text: String): String =
        text.split(' ').joinToString(" ") { w -> rewriteWord(w) ?: w }

    private fun spellSymbols(word: String): String {
        val body = trimEndPunct(word) { isAsciiPunct(it) && it != '/' }
        val parts = body.split('/')
        if (parts.size > 1 && parts.all { p -> p.length >= 2 && p.all { Character.isLetter(it) } && !SLASH_UNITS.contains(p) }) {
            return rewriteAll("${parts.joinToString(" ")}${word.substring(body.length)}")
        }
        if (!word.contains('@') && !word.contains('+')) return word
        val res = Appender()
        for (c in word) {
            when (c) {
                '@' -> res.pushSpoken("at")
                '+' -> res.pushSpoken("plus")
                else -> res.push(c)
            }
        }
        return rewriteAll(res.toString())
    }

    private fun digitRun(words: List<String>, startIdx: Int): Pair<String, Int>? {
        if (startIdx >= words.size) return null
        val plus = words[startIdx].startsWith('+')
        val bodies = ArrayList<String>()
        var end = ""
        for (i in startIdx until words.size) {
            var (body, tail) = splitSuffix(words[i])
            if (bodies.isEmpty() && plus) body = body.substring(1)
            val validGroup = body.length in 1..8 &&
                body.all { it in '0'..'9' || it in 'A'..'Z' } &&
                body.any { it in '0'..'9' }
            if (!validGroup) break
            bodies.add(body)
            if (tail.isNotEmpty()) {
                end = tail
                break
            }
        }
        val years = bodies.all { it.length == 4 && (it.startsWith("19") || it.startsWith("20")) }
        val longRun = bodies.size >= 3 && !years
        if (!longRun && !(bodies.size == 2 && (plus || bodies.any { it.startsWith('0') }))) return null
        val spelled = bodies.joinToString(", ") { spell(it) }
        return "${if (plus) "plus $spelled" else spelled}$end" to bodies.size
    }

    private fun rewriteText(text: String): String {
        val words = text.split(' ')
        val out = ArrayList<String>(words.size)
        var i = 0
        while (i < words.size) {
            // 1) scaled ($50 million)
            if (i + 1 < words.size) {
                val (scale, end) = splitSuffix(words[i + 1])
                val w0 = words[i]
                if (w0.length >= 2 && SCALE_WORDS.contains(scale)) {
                    val sym = when {
                        CURRENCIES.containsKey(w0[0]) -> w0[0] to w0.substring(1)
                        CURRENCIES.containsKey(w0.last()) -> w0.last() to w0.dropLast(1)
                        else -> null
                    }
                    val spoken = sym?.let { withScale(it.second, scale, it.first) }
                    if (spoken != null) {
                        out.add("$spoken$end")
                        i += 2
                        continue
                    }
                }
            }
            // 2) digitRun
            digitRun(words, i)?.let { (spoken, count) ->
                out.add(spoken)
                i += count
                continue
            }
            // 3) "ending in -XXXX"
            val prevWord = out.lastOrNull()?.lowercase()
            if (prevWord in setOf("ending", "ends", "ended") &&
                i + 1 < words.size &&
                words[i] == "in"
            ) {
                val (body, end) = splitSuffix(words[i + 1])
                if (body.startsWith('-')) {
                    val code = body.substring(1)
                    if (code.any { it in '0'..'9' } && code.all { it in '0'..'9' || it in 'A'..'Z' || it == '-' }) {
                        out.add("in ${spell(code)}$end")
                        i += 2
                        continue
                    }
                }
            }
            // 4) "Lt Col"
            if (words[i] == "Lt" && i + 1 < words.size) {
                val (rank, end) = splitSuffix(words[i + 1])
                if (rank == "Col") {
                    out.add("Lieutenant Colonel$end")
                    i += 2
                    continue
                }
            }
            out.add(rewriteWord(words[i]) ?: spellSymbols(words[i]))
            i++
        }
        return out.joinToString(" ")
    }

    fun normalizeEnglish(input: String): String {
        val res = Appender()
        val cps = input.codePoints().toArray()
        var i = 0
        var prevCp = -1
        while (i < cps.size) {
            val cp = cps[i]
            val c = if (cp <= 0xFFFF) cp.toChar() else '\u0000'
            when {
                c != '\u0000' && DOUBLE_QUOTES.contains(c) -> res.push('"')
                c != '\u0000' && SINGLE_QUOTES.contains(c) -> res.push('\'')
                c != '\u0000' && DASHES.contains(c) -> res.push('-')
                c == '\u2605' || c == '\u2606' -> {
                    var full = if (c == '\u2605') 1 else 0
                    var empty = if (c == '\u2606') 1 else 0
                    while (i + 1 < cps.size && (cps[i + 1] == 0x2605 || cps[i + 1] == 0x2606)) {
                        if (cps[++i] == 0x2605) full++ else empty++
                    }
                    val half = i + 1 < cps.size && cps[i + 1] == 0x00BD
                    if (half) i++
                    val n = if (half) "$full.5" else full.toString()
                    val of = if (empty > 0) full + empty + (if (half) 1 else 0) else null
                    res.pushSpoken(if (of == null) "$n stars" else "$n out of $of stars")
                }
                (c == '\u00B0' || c == '\u00BA') && res.endsWithN() -> {
                    if (res.last() == '.') res.popLast()
                    val lastN = res.last()
                    res.popLast()
                    res.pushSpoken(if (lastN == 'N') "Number" else "number")
                }
                c == '\u00B0' -> {
                    res.pushSpoken(if (res.endsWithOne()) "degree" else "degrees")
                    if (i + 1 < cps.size && (cps[i + 1] == 'C'.code || cps[i + 1] == 'F'.code)) {
                        val after = if (i + 2 < cps.size) cps[i + 2] else -1
                        if (after < 0 || !Character.isLetterOrDigit(after)) {
                            val scale = if (cps[++i] == 'C'.code) "Celsius" else "Fahrenheit"
                            res.pushStr(scale)
                        }
                    }
                }
                cp >= 0xCC && c != '\u0000' && FOLD_MAP.containsKey(c) -> res.push(FOLD_MAP.getValue(c))
                c != '\u0000' && SUBSCRIPTS.containsKey(c) -> res.pushStr(SUBSCRIPTS.getValue(c))
                c != '\u0000' && SUPERSCRIPTS.containsKey(c) -> {
                    val sb = StringBuilder(SUPERSCRIPTS.getValue(c))
                    while (i + 1 < cps.size && cps[i + 1] <= 0xFFFF && SUPERSCRIPTS.containsKey(cps[i + 1].toChar())) {
                        sb.append(SUPERSCRIPTS.getValue(cps[++i].toChar()))
                    }
                    val n = sb.toString()
                    if ((prevCp >= 0 && Character.isLetterOrDigit(prevCp)) || prevCp == ')'.code) {
                        val p = when (n) {
                            "2" -> "squared"
                            "3" -> "cubed"
                            else -> "to the power of $n"
                        }
                        res.pushSpoken(p)
                    } else {
                        res.pushStr(n)
                    }
                }
                greekName(cp) != null -> res.pushSpoken(greekName(cp)!!)
                c != '\u0000' && SYMBOLS.containsKey(c) -> res.pushSpoken(SYMBOLS.getValue(c))
                c == '\u00B1' -> res.pushSpoken("plus or minus")
                c == '\u2764' || c == '\u2665' -> {
                    if (i + 1 < cps.size && cps[i + 1] == 0xFE0F) i++
                    res.pushSpoken("love")
                }
                c == '~' && i + 1 < cps.size && cps[i + 1] in '0'.code..'9'.code -> res.pushSpoken("about")
                c == '*' && (prevCp < 0 || Character.isWhitespace(prevCp)) &&
                    i + 1 < cps.size && cps[i + 1] in '0'.code..'9'.code -> res.pushSpoken("star")
                c != '\u0000' && (SPACERS.contains(c) || BULLETS.contains(c)) -> res.pushWhitespace()
                c != '\u0000' && CURRENCIES.containsKey(c) && res.endsWithSpacedDigit() &&
                    !(i + 1 < cps.size && cps[i + 1] in '0'.code..'9'.code) -> {
                    res.popWhitespace()
                    res.push(c)
                }
                c == '\u2026' -> res.push('.')
                c == '=' -> res.pushSpoken("equals")
                c == ':' && prevCp >= 0 && !Character.isWhitespace(prevCp) &&
                    i + 1 < cps.size && !Character.isWhitespace(cps[i + 1]) -> res.push(':')
                c != '\u0000' && c in ";:()" -> {
                    res.popWhitespace()
                    res.push(',')
                    res.pushWhitespace()
                }
                isEmojiCp(cp) || Character.isISOControl(cp) || Character.isWhitespace(cp) -> res.pushWhitespace()
                else -> res.pushStr(String(Character.toChars(cp)))
            }
            prevCp = cp
            i++
        }
        var out = rewriteText(res.toString())
        out = trimEndPunct(out) { it == '"' }
        if (out.endsWith("'") && out.length >= 2 && out[out.length - 2] in ".!?,;") {
            out = out.dropLast(1)
        }
        return out
    }

    fun preparePrompt(input: String): PhononPreparedPrompt {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return PhononPreparedPrompt("", 3)
        val words = trimmed.replace('\n', ' ').replace('\r', ' ')
            .split(Regex("\\s+"))
            .filter { it.isNotEmpty() }
        if (words.isEmpty()) return PhononPreparedPrompt("", 3)
        val framesAfterEos = if (words.size <= 4) 3 else 1
        var text = words.joinToString(" ")
        val firstCp = text.codePointAt(0)
        val firstLen = Character.charCount(firstCp)
        val upperFirst = String(Character.toChars(Character.toTitleCase(firstCp)))
        text = upperFirst + text.substring(firstLen)
        val lastCp = text.codePointBefore(text.length)
        if (Character.isLetterOrDigit(lastCp)) {
            text += "."
        }
        return PhononPreparedPrompt(text, framesAfterEos)
    }

    private fun frameBudget(tokenCount: Int, frameRate: Float): Int =
        ceil((tokenCount / 3.0 + 2.0) * frameRate.toDouble()).toInt()

    private fun makeChunk(
        tokenizer: PhononTokenizer,
        text: String,
        frameRate: Float
    ): PhononChunkPlan {
        val prepared = preparePrompt(text)
        val tokens = tokenizer.encode(prepared.text)
        return PhononChunkPlan(
            text = text,
            tokens = tokens,
            framesAfterEos = prepared.framesAfterEos,
            frameBudget = frameBudget(tokens.size, frameRate)
        )
    }

    private fun splitSentences(
        tokenizer: PhononTokenizer,
        text: String,
        maxTokens: Int = MAX_TOKENS_PER_CHUNK
    ): List<String> {
        val prepared = preparePrompt(text).text.trim()
        if (prepared.isEmpty()) return emptyList()
        val tokens = tokenizer.encode(prepared)
        if (tokens.isEmpty()) return emptyList()

        val marker = tokenizer.encode(".!...\u003F")
        val ends = (if (marker.size > 1) marker.drop(1) else marker.toList()).toSet()
        val bounds = ArrayList<Int>()
        bounds.add(0)
        var previous = false
        tokens.forEachIndexed { idx, tok ->
            if (ends.contains(tok)) {
                previous = true
            } else {
                if (previous) bounds.add(idx)
                previous = false
            }
        }
        bounds.add(tokens.size)

        val chunks = ArrayList<String>()
        var current = ""
        var count = 0
        for (i in 0 until bounds.size - 1) {
            val n = bounds[i + 1] - bounds[i]
            val sentence = tokenizer.decode(tokens.copyOfRange(bounds[i], bounds[i + 1]))
            if (current.isEmpty()) {
                current = sentence
                count = n
            } else if (count + n > maxTokens) {
                chunks.add(current.trim())
                current = sentence
                count = n
            } else {
                current += " $sentence"
                count += n
            }
        }
        if (current.isNotEmpty()) chunks.add(current.trim())
        return chunks
    }

    private fun cutWordSplitIndex(
        tokenizer: PhononTokenizer,
        words: List<String>,
        minSide: Int
    ): Int {
        val ends = IntArray(words.size)
        var total = 0
        for (i in words.indices) {
            total += tokenizer.encode(words[i]).size
            ends[i] = total
        }
        if (words.size <= 1) return 1

        fun bestByMarks(marks: String?): Int? {
            var bestIdx: Int? = null
            var bestImbalance = Int.MAX_VALUE
            for (i in 0 until words.size - 1) {
                val end = ends[i]
                if (marks != null) {
                    val trimmed = trimEndPunct(words[i]) { it in CLOSERS }
                    val lastChar = trimmed.lastOrNull()
                    if (lastChar == null || lastChar !in marks) continue
                    if (end < minSide || total - end < minSide) continue
                }
                val imb = abs(end - (total - end))
                if (imb < bestImbalance) {
                    bestImbalance = imb
                    bestIdx = i
                }
            }
            return bestIdx
        }

        val idx = bestByMarks(".!?") ?: bestByMarks(",;:") ?: bestByMarks(null) ?: 0
        return idx + 1
    }

    fun planChunks(
        tokenizer: PhononTokenizer,
        rawText: String,
        frameRate: Float = 12.5f
    ): List<PhononChunkPlan> {
        val normalized = normalizeEnglish(rawText)
        if (normalized.isBlank()) return emptyList()

        val initial = splitSentences(tokenizer, normalized).map { t ->
            makeChunk(tokenizer, t, frameRate)
        }
        val fitted = ArrayList<PhononChunkPlan>(initial.size)
        val todo = ArrayDeque<PhononChunkPlan>(initial.size)
        for (c in initial) todo.addLast(c)

        while (todo.isNotEmpty()) {
            val c = todo.removeFirst()
            if (c.tokens.size <= MAX_FIT_TOKENS) {
                fitted.add(c)
                continue
            }
            val words = c.text.split(Regex("\\s+")).filter { it.isNotEmpty() }
            val halves: Pair<String, String> = if (words.size >= 2) {
                val at = cutWordSplitIndex(tokenizer, words, ceil(MAX_FIT_TOKENS / 4.0).toInt())
                words.subList(0, at).joinToString(" ") to words.subList(at, words.size).joinToString(" ")
            } else {
                val trimmed = c.text.trim()
                val mid = trimmed.length / 2
                if (mid == 0) {
                    fitted.add(c)
                    continue
                }
                trimmed.substring(0, mid) to trimmed.substring(mid)
            }
            val right = makeChunk(tokenizer, halves.second, frameRate)
            val left = makeChunk(tokenizer, halves.first, frameRate)
            todo.addFirst(right)
            todo.addFirst(left)
        }
        return fitted
    }
}
