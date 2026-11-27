#include "SanitizerAndChunker.h"

#include <algorithm>
#include <cctype>

namespace aotg::audio {

namespace {

constexpr std::string_view kOpenThink = "<think>";
constexpr std::string_view kCloseThink = "</think>";
constexpr std::string_view kOpenGemma = "<|channel>thought";
constexpr std::string_view kCloseGemma = "<channel|>";

inline bool startsWith(std::string_view haystack, std::string_view prefix) {
    return haystack.size() <= prefix.size() &&
           prefix.compare(0, haystack.size(), haystack) == 0;
}

inline bool endsWith(std::string_view haystack, std::string_view suffix) {
    return haystack.size() >= suffix.size() &&
           haystack.compare(haystack.size() - suffix.size(), suffix.size(), suffix) == 0;
}

inline bool isStrongEndPunct(char c) {
    return c == '.' || c == '!' || c == '?';
}

inline bool isSoftBreakPunct(char c) {
    return c == ',' || c == ';' || c == ':';
}

size_t countWords(std::string_view sv) {
    size_t words = 0;
    bool inWord = false;
    for (char c : sv) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            inWord = false;
        } else if (!inWord) {
            inWord = true;
            ++words;
        }
    }
    return words;
}

std::string trimCopy(std::string_view sv) {
    size_t start = 0;
    while (start < sv.size() && std::isspace(static_cast<unsigned char>(sv[start]))) {
        ++start;
    }
    size_t end = sv.size();
    while (end > start && std::isspace(static_cast<unsigned char>(sv[end - 1]))) {
        --end;
    }
    return std::string(sv.substr(start, end - start));
}

} // namespace

void SanitizerAndChunker::reset() {
    mode_ = ParseMode::Normal;
    tagBuf_.clear();
    closeBuf_.clear();
    backtickBuf_.clear();
    schemeBuf_.clear();
    linkBracketBuf_.clear();
    atLineStart_ = true;
    prevWasSpace_ = true;
    prevWasBracketClose_ = false;
    inMarkdownLinkParen_ = false;
    fullSanitized_.clear();
    pendingClause_.clear();
    pendingStartOffset_ = 0;
    nextClauseId_ = 0;
}

std::vector<EmittedClause> SanitizerAndChunker::pushToken(
    std::string_view rawChunk,
    std::string* outSanitizedDelta) {
    std::string delta;

    for (char c : rawChunk) {
        if (mode_ == ParseMode::InThinkTag) {
            closeBuf_.push_back(c);
            if (closeBuf_.size() > kCloseThink.size()) {
                closeBuf_.erase(0, closeBuf_.size() - kCloseThink.size());
            }
            if (endsWith(closeBuf_, kCloseThink)) {
                closeBuf_.clear();
                mode_ = ParseMode::Normal;
                atLineStart_ = true;
            }
            continue;
        }

        if (mode_ == ParseMode::InGemmaThought) {
            closeBuf_.push_back(c);
            if (closeBuf_.size() > kCloseGemma.size()) {
                closeBuf_.erase(0, closeBuf_.size() - kCloseGemma.size());
            }
            if (endsWith(closeBuf_, kCloseGemma)) {
                closeBuf_.clear();
                mode_ = ParseMode::Normal;
                atLineStart_ = true;
            }
            continue;
        }

        if (mode_ == ParseMode::InCodeFence) {
            if (c == '`') {
                backtickBuf_.push_back('`');
                if (backtickBuf_.size() == 3) {
                    backtickBuf_.clear();
                    mode_ = ParseMode::Normal;
                    atLineStart_ = false;
                }
            } else {
                backtickBuf_.clear();
            }
            continue;
        }

        if (mode_ == ParseMode::InUrl) {
            const unsigned char uc = static_cast<unsigned char>(c);
            if (std::isspace(uc) || c == ')' || c == ']' || c == '>' || c == '"' || c == '\'') {
                mode_ = ParseMode::Normal;
                if (inMarkdownLinkParen_ && c == ')') {
                    inMarkdownLinkParen_ = false;
                    continue;
                }
                inMarkdownLinkParen_ = false;
                feedNormalChar(c, &delta);
            }
            continue;
        }

        if (mode_ == ParseMode::MaybeTag) {
            tagBuf_.push_back(c);
            if (tagBuf_ == kOpenThink) {
                tagBuf_.clear();
                closeBuf_.clear();
                mode_ = ParseMode::InThinkTag;
                continue;
            }
            if (tagBuf_ == kOpenGemma) {
                tagBuf_.clear();
                closeBuf_.clear();
                mode_ = ParseMode::InGemmaThought;
                continue;
            }
            if (startsWith(tagBuf_, kOpenThink) || startsWith(tagBuf_, kOpenGemma)) {
                continue;
            }
            // Flush previously buffered prefix (without `c`), then re-process `c` in Normal mode.
            tagBuf_.pop_back();
            std::string flushed = std::move(tagBuf_);
            tagBuf_.clear();
            mode_ = ParseMode::Normal;
            for (char fc : flushed) {
                feedNormalChar(fc, &delta);
            }
            if (c == '<') {
                mode_ = ParseMode::MaybeTag;
                tagBuf_.push_back('<');
            } else {
                feedNormalChar(c, &delta);
            }
            continue;
        }

        // Normal mode
        if (c == '<') {
            if (!backtickBuf_.empty()) {
                backtickBuf_.clear();
            }
            if (!schemeBuf_.empty()) {
                appendSanitizedLiteral(schemeBuf_, &delta);
                schemeBuf_.clear();
            }
            mode_ = ParseMode::MaybeTag;
            tagBuf_.push_back('<');
            continue;
        }

        feedNormalChar(c, &delta);
    }

    if (outSanitizedDelta && !delta.empty()) {
        outSanitizedDelta->append(delta);
    }

    std::vector<EmittedClause> clauses;
    tryEmitClauses(clauses);
    return clauses;
}

std::vector<EmittedClause> SanitizerAndChunker::flush(std::string* outSanitizedDelta) {
    std::string delta;

    if (mode_ == ParseMode::MaybeTag && !tagBuf_.empty()) {
        std::string flushed = std::move(tagBuf_);
        tagBuf_.clear();
        mode_ = ParseMode::Normal;
        for (char fc : flushed) {
            feedNormalChar(fc, &delta);
        }
    }
    if (!schemeBuf_.empty()) {
        appendSanitizedLiteral(schemeBuf_, &delta);
        schemeBuf_.clear();
    }
    backtickBuf_.clear();

    if (outSanitizedDelta && !delta.empty()) {
        outSanitizedDelta->append(delta);
    }

    std::vector<EmittedClause> clauses;
    tryEmitClauses(clauses);
    emitCurrentPending(clauses);
    return clauses;
}

void SanitizerAndChunker::feedNormalChar(char c, std::string* deltaOut) {
    if (c == '`') {
        if (!schemeBuf_.empty()) {
            appendSanitizedLiteral(schemeBuf_, deltaOut);
            schemeBuf_.clear();
        }
        backtickBuf_.push_back('`');
        if (backtickBuf_.size() == 3) {
            backtickBuf_.clear();
            mode_ = ParseMode::InCodeFence;
            appendSanitizedLiteral(" Here is a code snippet. ", deltaOut);
        }
        return;
    } else if (!backtickBuf_.empty()) {
        // Inline backtick(s) stripped cleanly
        backtickBuf_.clear();
    }

    // Track "(https://" from markdown links [label](https://...)
    if (prevWasBracketClose_ && c == '(') {
        if (!schemeBuf_.empty()) {
            appendSanitizedLiteral(schemeBuf_, deltaOut);
            schemeBuf_.clear();
        }
        inMarkdownLinkParen_ = true;
        prevWasBracketClose_ = false;
        return;
    }
    if (prevWasBracketClose_) {
        prevWasBracketClose_ = false;
    }

    if (inMarkdownLinkParen_) {
        if (c == ')') {
            schemeBuf_.clear();
            inMarkdownLinkParen_ = false;
            return;
        }
        schemeBuf_.push_back(c);
        if (schemeBuf_ == "http://" || schemeBuf_ == "https://") {
            schemeBuf_.clear();
            mode_ = ParseMode::InUrl;
        } else if (!startsWith(schemeBuf_, "http://") && !startsWith(schemeBuf_, "https://") &&
                   schemeBuf_.size() > 8) {
            // Unexpected non-URL inside (...) right after []
            appendSanitizedChar('(', deltaOut);
            appendSanitizedLiteral(schemeBuf_, deltaOut);
            schemeBuf_.clear();
            inMarkdownLinkParen_ = false;
        }
        return;
    }

    // Detect bare http:// or https:// URLs
    if (!schemeBuf_.empty() || c == 'h') {
        schemeBuf_.push_back(c);
        if (schemeBuf_ == "http://" || schemeBuf_ == "https://") {
            schemeBuf_.clear();
            mode_ = ParseMode::InUrl;
            appendSanitizedLiteral("a link", deltaOut);
            return;
        }
        if (startsWith(schemeBuf_, "http://") || startsWith(schemeBuf_, "https://")) {
            return;
        }
        // Mismatch: flush prior buffered prefix without `c`, then re-process `c` cleanly.
        schemeBuf_.pop_back();
        std::string flushed = std::move(schemeBuf_);
        schemeBuf_.clear();
        for (char sc : flushed) {
            appendSanitizedChar(sc, deltaOut);
        }
        atLineStart_ = false;
        if (c == 'h') {
            schemeBuf_.push_back('h');
            return;
        }
    }

    if (c == ']') {
        prevWasBracketClose_ = true;
        return;
    }
    if (c == '[') {
        prevWasBracketClose_ = false;
        return;
    }

    // Strip markdown decoration tokens
    if (c == '*' || c == '_' || c == '#' || c == '~') {
        return;
    }

    // Line-start bullets / blockquotes (preserve atLineStart_ across leading indentation)
    if (atLineStart_) {
        if (c == ' ' || c == '\t') {
            appendSanitizedChar(' ', deltaOut);
            return;
        }
        if (c == '-' || c == '>') {
            return;
        }
    }

    if (c == '\r' || c == '\n') {
        atLineStart_ = true;
        appendSanitizedChar(' ', deltaOut);
        return;
    }

    atLineStart_ = false;
    appendSanitizedChar(c, deltaOut);
}

void SanitizerAndChunker::appendSanitizedLiteral(std::string_view text, std::string* deltaOut) {
    for (char c : text) {
        appendSanitizedChar(c, deltaOut);
    }
}

void SanitizerAndChunker::appendSanitizedChar(char c, std::string* deltaOut) {
    const bool isSpace = std::isspace(static_cast<unsigned char>(c)) != 0;
    if (isSpace) {
        if (prevWasSpace_ || fullSanitized_.empty()) {
            return;
        }
        prevWasSpace_ = true;
        fullSanitized_.push_back(' ');
        if (!pendingClause_.empty()) {
            pendingClause_.push_back(' ');
        } else {
            pendingStartOffset_ = static_cast<int32_t>(fullSanitized_.size());
        }
        if (deltaOut) deltaOut->push_back(' ');
        return;
    }

    prevWasSpace_ = false;
    if (pendingClause_.empty()) {
        pendingStartOffset_ = static_cast<int32_t>(fullSanitized_.size());
    }
    fullSanitized_.push_back(c);
    pendingClause_.push_back(c);
    if (deltaOut) deltaOut->push_back(c);
}

void SanitizerAndChunker::tryEmitClauses(std::vector<EmittedClause>& out) {
    while (!pendingClause_.empty()) {
        const bool isFirstClause = (nextClauseId_ == 0);
        const size_t softMin = isFirstClause ? 3u : 8u;
        const size_t strongMin = isFirstClause ? 2u : 3u;
        const size_t hardMax = isFirstClause ? 5u : 14u;

        // Scan pendingClause_ at word boundaries to preserve exact tail beyond split.
        size_t words = 0;
        bool inWord = false;
        size_t splitPos = std::string::npos;

        for (size_t i = 0; i < pendingClause_.size(); ++i) {
            const char c = pendingClause_[i];
            const bool isSpace = std::isspace(static_cast<unsigned char>(c)) != 0;

            if (!isSpace && !inWord) {
                inWord = true;
                ++words;
            } else if (isSpace && inWord) {
                inWord = false;
            }

            const bool followedBySpace = (i + 1 < pendingClause_.size()) &&
                                         std::isspace(static_cast<unsigned char>(pendingClause_[i + 1]));
            const bool isDevanagariDandaEnd =
                i >= 2 &&
                static_cast<unsigned char>(pendingClause_[i - 2]) == 0xE0 &&
                static_cast<unsigned char>(pendingClause_[i - 1]) == 0xA5 &&
                (static_cast<unsigned char>(c) == 0xA4 || static_cast<unsigned char>(c) == 0xA5);

            if ((isStrongEndPunct(c) && followedBySpace && words >= strongMin) ||
                (isDevanagariDandaEnd && (followedBySpace || i + 1 < pendingClause_.size()) && words >= strongMin)) {
                splitPos = i + 1;
                break;
            }
            if (isSoftBreakPunct(c) && followedBySpace && words >= softMin) {
                splitPos = i + 1;
                break;
            }
            if (isSpace && words >= hardMax) {
                splitPos = i;
                break;
            }
        }

        if (splitPos == std::string::npos) {
            break;
        }

        std::string slice = trimCopy(std::string_view(pendingClause_).substr(0, splitPos));
        const int32_t sliceEndOffset = pendingStartOffset_ + static_cast<int32_t>(splitPos);

        // Advance past splitPos and any separating whitespace cleanly.
        size_t nextStart = splitPos;
        while (nextStart < pendingClause_.size() &&
               std::isspace(static_cast<unsigned char>(pendingClause_[nextStart]))) {
            ++nextStart;
        }
        pendingClause_.erase(0, nextStart);
        pendingStartOffset_ += static_cast<int32_t>(nextStart);

        if (!slice.empty()) {
            out.push_back(EmittedClause{
                nextClauseId_++,
                pendingStartOffset_ - static_cast<int32_t>(nextStart),
                sliceEndOffset,
                std::move(slice),
            });
        }
    }
}

void SanitizerAndChunker::emitCurrentPending(std::vector<EmittedClause>& out) {
    std::string remaining = trimCopy(pendingClause_);
    const int32_t endOffset = static_cast<int32_t>(fullSanitized_.size());
    const int32_t startOffset = pendingStartOffset_;
    pendingClause_.clear();
    pendingStartOffset_ = endOffset;
    if (!remaining.empty() && countWords(remaining) > 0) {
        out.push_back(EmittedClause{
            nextClauseId_++,
            startOffset,
            endOffset,
            std::move(remaining),
        });
    }
}

} // namespace aotg::audio
