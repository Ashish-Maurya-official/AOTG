package com.ashish.technologies.aotg.turbo_modules.agenttools

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class PublicWebClientTest {
    @Test fun blocksPrivateAndSpecialAddresses() {
        listOf("127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "2001:db8::1",
            "::ffff:127.0.0.1", "64:ff9b::7f00:1").forEach {
            assertFalse(it, PublicWebClient.isPublicAddress(InetAddress.getByName(it)))
        }
        assertTrue(PublicWebClient.isPublicAddress(InetAddress.getByName("8.8.8.8")))
        assertTrue(PublicWebClient.isPublicAddress(InetAddress.getByName("2606:4700:4700::1111")))
    }

    @Test fun rejectsUnsafeUrlsBeforeConnecting() {
        listOf("http://example.com", "https://user:pass@example.com", "https://example.com:8443",
            "https://127.0.0.1", "https://[::1]", "file:///etc/passwd", "https://router.local").forEach {
            assertTrue(it, runCatching { PublicWebClient.validateUrl(it) }.isFailure)
        }
        assertEquals("example.com", PublicWebClient.validateUrl("https://example.com/page").host)
    }

    @Test fun cancellationBeforeDispatchPreventsNetworkAndReleasesRequestId() {
        val client = PublicWebClient()
        try {
            client.prepare("cancel-before-fetch")
            assertTrue(runCatching { client.prepare("cancel-before-fetch") }.isFailure)
            client.cancel("cancel-before-fetch")
            val result = runCatching { client.fetch("cancel-before-fetch", "https://example.com") }
            assertTrue(result.exceptionOrNull()?.message?.contains("cancelled") == true)
            assertTrue(runCatching { client.prepare("cancel-before-fetch") }.isSuccess)
        } finally {
            client.close()
        }
    }

    @Test fun overlappingDomTextCannotExpandWithoutBound() {
        val blocks = sequence {
            repeat(10) { yield("content ".repeat(10000)) }
            error("Extraction should stop before traversing the rest of the page")
        }
        assertEquals(PublicWebClient.MAX_TEXT_CHARS + 1, PublicWebClient.boundedJoin(blocks, "\n\n").length)
        assertEquals("Name | Price", PublicWebClient.boundedJoin(sequenceOf("Name", "Price"), " | "))
    }
}
