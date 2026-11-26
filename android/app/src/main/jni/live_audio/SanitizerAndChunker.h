#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace aotg::audio {

struct EmittedClause {
    int32_t clauseId = 0;
    int32_t charStartOffset = 0;
    int32_t charEndOffset = 0;
    std::string text;
};

/**
 * Streaming inline sanitizer + Two-Tier Clause Chunker.
 *
 * Sanitization removes:
 * - `<think>...</think>` and Gemma 4 `<|channel>thought...<channel|>` blocks
 * - Fenced code blocks (replaced once with `" Here is a code snippet. "`)
 * - Markdown formatting symbols (`*`, `_`, `#`, `` ` ``, `~`) and link syntax
 * - Raw `http://` / `https://` URLs
 *
 * Clause Chunking:
 * - Clause 0 (Speed Path): flushes after 3-5 words (or >=2 words on strong punctuation)
 * - Clauses 1+ (Prosody Path): flushes after 8-14 words (or >=3 words on strong sentence end)
 */
class SanitizerAndChunker {
public:
    SanitizerAndChunker() = default;

    void reset();

    /**
     * Pushes a raw LLM token chunk and returns any newly ready speech clauses,
     * appending newly sanitized display text into `outSanitizedDelta`.
     */
    std::vector<EmittedClause> pushToken(
        std::string_view rawChunk,
        std::string* outSanitizedDelta = nullptr);

    /**
     * Flushes any trailing buffered characters/words at end of generation.
     */
    std::vector<EmittedClause> flush(std::string* outSanitizedDelta = nullptr);

    const std::string& fullSanitizedText() const { return fullSanitized_; }

private:
    enum class ParseMode {
        Normal,
        MaybeTag,
        InThinkTag,
        InGemmaThought,
        InCodeFence,
        InUrl
    };

    void feedNormalChar(char c, std::string* deltaOut);
    void appendSanitizedChar(char c, std::string* deltaOut);
    void appendSanitizedLiteral(std::string_view text, std::string* deltaOut);
    void tryEmitClauses(std::vector<EmittedClause>& out);
    void emitCurrentPending(std::vector<EmittedClause>& out);

    ParseMode mode_ = ParseMode::Normal;
    std::string tagBuf_;
    std::string closeBuf_;
    std::string backtickBuf_;
    std::string schemeBuf_;
    std::string linkBracketBuf_;

    bool atLineStart_ = true;
    bool prevWasSpace_ = true;
    bool prevWasBracketClose_ = false;
    bool inMarkdownLinkParen_ = false;

    std::string fullSanitized_;
    std::string pendingClause_;
    int32_t pendingStartOffset_ = 0;
    int32_t nextClauseId_ = 0;
};

} // namespace aotg::audio
