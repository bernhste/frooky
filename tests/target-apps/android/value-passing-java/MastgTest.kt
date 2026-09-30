package org.owasp.mastestapp

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.LabeledIntent
import android.content.pm.PackageManager
import android.hardware.biometrics.BiometricPrompt
import android.location.Location
import android.net.Uri
import android.os.Bundle
import android.os.Parcelable
import android.os.PersistableBundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.math.BigDecimal
import java.math.BigInteger
import android.webkit.WebResourceRequest
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.security.Key
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.AlgorithmParameterSpec
import java.security.spec.KeySpec
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

// A top-level function is a static method of the class MastgTestKt.
fun receiveStatic(arg: String): String = arg

// Constructed in mastgTest(), so its class is only loaded after pressing Start.
class Secret(val value: String)

// Implements the unrelated interfaces Map and Iterable, both with a decoder, like OkHttp's Headers.
class Headers : LinkedHashMap<String, String>(), Iterable<Map.Entry<String, String>> {
        override fun iterator(): Iterator<Map.Entry<String, String>> = entries.iterator()
}

// Decoded with `decoder: getters`: getName(), getAge() and isAdmin().
class UserProfile(val name: String, val age: Int, val isAdmin: Boolean)

// HIGH has a body, which makes it a subclass of Level, and overrides toString().
enum class Level {
        LOW,
        HIGH {
                override fun toString() = "high!"
        }
}

// Stands in for the request a WebView passes to WebViewClient.shouldInterceptRequest().
class ApiRequest(private val url: String) : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(url)
        override fun isForMainFrame() = false
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = "POST"
        override fun getRequestHeaders() = mapOf("Authorization" to "Bearer abc123")
}

// Stands in for a third-party library that calls into the app, for stack trace filters.
class ThirdPartySdk {
        fun flush(test: MastgTest): String = test.trackEvent("sdk_flush")
}

class MastgTest(private val context: Context) {
        companion object {
                // compiled to static final fields of MastgTest, for the `constant` decoder
                const val MODE_ENCRYPT = 1
                const val MODE_DECRYPT = 2
        }

        fun initRsaKeyPair(): String {
                val keyPairGenerator =
                        KeyPairGenerator.getInstance(
                                KeyProperties.KEY_ALGORITHM_RSA,
                                "AndroidKeyStore"
                        )

                // Define what the key can be used for and how
                val spec =
                        KeyGenParameterSpec.Builder(
                                        "TestKeyPair",
                                        KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                                )
                                .setKeySize(2048)
                                .setDigests(
                                        KeyProperties.DIGEST_SHA256,
                                        KeyProperties.DIGEST_SHA512
                                )
                                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                                .build()

                keyPairGenerator.initialize(spec)

                return "Initialized RAS Key Pair with Spec: ${spec.toString()}"
        }

        fun buildIntentWithFlags(): String {
                val securityFlags =
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION or
                                Intent.FLAG_ACTIVITY_NEW_TASK or
                                Intent.FLAG_ACTIVITY_CLEAR_TASK

                Intent(Intent.ACTION_VIEW, Uri.EMPTY).apply {
                        setPackage("org.owasp.mastestapp")
                        setFlags(securityFlags)
                }
                return "Intent with various flags sent. Binary masked integer is: $securityFlags"
        }

        // Single types
        fun receiveString(arg: String): String = arg
        fun receiveBoolean(arg: Boolean): Boolean = arg
        fun receiveByte(arg: Byte): Byte = arg
        fun receiveShort(arg: Short): Short = arg
        fun receiveInt(arg: Int): Int = arg
        fun receiveLong(arg: Long): Long = arg
        fun receiveFloat(arg: Float): Float = arg
        fun receiveDouble(arg: Double): Double = arg
        fun receiveChar(arg: Char): Char = arg

        fun receiveBigInteger(arg: BigInteger): BigInteger = arg
        fun receiveBigDecimal(arg: BigDecimal): BigDecimal = arg
        fun receiveList(arg: List<String>): List<String> = arg
        fun receiveMap(arg: Map<String, String>): Map<String, String> = arg
        fun receiveSet(arg: Set<String>): Set<String> = arg

        enum class Direction {
                NORTH,
                SOUTH,
                EAST,
                WEST
        }
        fun receiveEnum(arg: Direction): Direction = arg

        // Arrays
        fun receiveStringArray(arg: Array<String>): Array<String> = arg
        fun receiveBooleanArray(arg: BooleanArray): BooleanArray = arg
        fun receiveByteArray(arg: ByteArray): ByteArray = arg
        fun receiveShortArray(arg: ShortArray): ShortArray = arg
        fun receiveIntArray(arg: IntArray): IntArray = arg
        fun receiveLongArray(arg: LongArray): LongArray = arg
        fun receiveFloatArray(arg: FloatArray): FloatArray = arg
        fun receiveDoubleArray(arg: DoubleArray): DoubleArray = arg
        fun receiveCharArray(arg: CharArray): CharArray = arg
        fun receiveNestedObjectArray(
                arg: Array<Array<Array<String>>>
        ): Array<Array<Array<String>>> = arg
        fun receiveNestedPrimitivesArray(arg: Array<Array<IntArray>>): Array<Array<IntArray>> = arg
        fun receiveNestedList(arg: List<List<String>>): List<List<String>> = arg

        // Overloads
        fun receiveOverloaded(arg: Int): Int = arg
        fun receiveOverloaded(arg: String): String = arg
        fun receiveOverloaded(first: String, second: Int): String = "$first$second"

        // Output parameter: copies a secret into `out` and returns its length.
        fun fillSecret(out: ByteArray): Int {
                val secret = "s3cr3t".toByteArray()
                secret.copyInto(out)
                return secret.size
        }

        // In/out parameter: XORs every byte with 0x20 in place, e.g. "frooky" becomes "FROOKY".
        fun toggleCase(data: ByteArray): ByteArray {
                for (i in data.indices) data[i] = (data[i].toInt() xor 0x20).toByte()
                return data
        }

        fun receiveMode(mode: Int): Int = mode
        fun receiveTextBytes(arg: ByteArray): ByteArray = arg
        fun receiveBundle(arg: Bundle): Bundle = arg
        fun receiveContentValues(arg: ContentValues): ContentValues = arg
        fun receiveClipData(arg: ClipData): ClipData = arg
        fun receiveIntent(arg: Intent): Intent = arg
        fun receiveParcelable(arg: Parcelable): Parcelable = arg
        fun receiveAny(arg: Any): Any = arg
        fun receiveHeaders(arg: Headers): Headers = arg
        fun receiveByteBuffer(arg: ByteBuffer): ByteBuffer = arg
        fun receiveMapEntry(arg: Map.Entry<String, String>): Map.Entry<String, String> = arg
        fun receiveCharSequence(arg: CharSequence): CharSequence = arg
        fun receiveLevel(arg: Level): Level = arg
        fun receivePassword(arg: CharArray): CharArray = arg
        fun receiveProfile(arg: UserProfile): UserProfile = arg
        fun receivePersistableBundle(arg: PersistableBundle): PersistableBundle = arg
        fun receiveLocation(arg: Location): Location = arg
        fun receiveWebResourceRequest(arg: WebResourceRequest): WebResourceRequest = arg
        fun receiveKey(arg: Key): Key = arg
        fun receiveParameterSpec(arg: AlgorithmParameterSpec): AlgorithmParameterSpec = arg
        fun receiveKeySpec(arg: KeySpec): KeySpec = arg
        fun receiveCipher(arg: Cipher): Cipher = arg
        fun receiveMac(arg: Mac): Mac = arg
        fun receiveSignature(arg: Signature): Signature = arg
        fun receiveMessageDigest(arg: MessageDigest): MessageDigest = arg
        fun receiveCertificate(arg: X509Certificate): X509Certificate = arg
        fun receiveAppSignature(arg: android.content.pm.Signature): android.content.pm.Signature = arg
        fun receiveCryptoObject(arg: BiometricPrompt.CryptoObject): BiometricPrompt.CryptoObject = arg
        fun trackEvent(name: String): String = name

        // Passes the objects of a typical encryption, signing and signature check to the receive* methods.
        fun useCryptoTypes(): String {
                val key = SecretKeySpec(ByteArray(16) { it.toByte() }, "AES")
                receiveKey(key)
                val gcmSpec = GCMParameterSpec(128, ByteArray(12) { it.toByte() })
                receiveParameterSpec(gcmSpec)
                receiveKeySpec(PBEKeySpec("s3cr3t".toCharArray(), byteArrayOf(0x0a, 0x0b), 1000, 256))

                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.ENCRYPT_MODE, key, gcmSpec)
                receiveCipher(cipher)
                // not initialized: the provider is chosen on init()
                receiveMac(Mac.getInstance("HmacSHA256"))
                val signature = Signature.getInstance("SHA256withECDSA")
                signature.initSign(KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair().private)
                receiveSignature(signature)
                receiveMessageDigest(MessageDigest.getInstance("SHA-256"))

                val appSignature =
                        context.packageManager
                                .getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                                .signingInfo!!
                                .apkContentsSigners[0]
                receiveAppSignature(appSignature)
                val certificate =
                        CertificateFactory.getInstance("X.509")
                                .generateCertificate(ByteArrayInputStream(appSignature.toByteArray())) as X509Certificate
                receiveCertificate(certificate)
                receiveCryptoObject(BiometricPrompt.CryptoObject(cipher))
                return "crypto types"
        }

        fun mastgTest(): String {
                val r = DemoResults("basic-parameter")

                receiveString("Welcome the first OWASP MASCon 📱❤️")
                r.add(Status.PASS, "Welcome the first OWASP MASCon 📱❤️")

                receiveBoolean(true)
                r.add(Status.PASS, true.toString())

                receiveByte(127)
                r.add(Status.PASS, 127.toString())

                receiveShort(32767)
                r.add(Status.PASS, 32767.toString())

                receiveInt(2147483647)
                r.add(Status.PASS, 2147483647.toString())

                receiveLong(9223372036854775807L)
                r.add(Status.PASS, 9223372036854775807L.toString())

                receiveFloat(3.14f)
                r.add(Status.PASS, 3.14f.toString())

                receiveDouble(3.141592653589793)
                r.add(Status.PASS, 3.141592653589793.toString())

                receiveChar('A')
                r.add(Status.PASS, 'A'.toString())

                val stringArray = arrayOf("a", "b", "c")
                receiveStringArray(stringArray)
                r.add(Status.PASS, stringArray.joinToString())

                val boolArray = booleanArrayOf(true, false)
                receiveBooleanArray(boolArray)
                r.add(Status.PASS, boolArray.joinToString())

                val byteArray = byteArrayOf(1, 2, 3)
                receiveByteArray(byteArray)
                r.add(Status.PASS, byteArray.joinToString())

                val shortArray = shortArrayOf(1, 2, 3)
                receiveShortArray(shortArray)
                r.add(Status.PASS, shortArray.joinToString())

                val intArray = intArrayOf(1, 2, 3)
                receiveIntArray(intArray)
                r.add(Status.PASS, intArray.joinToString())

                val longArray =
                        longArrayOf(
                                9223372036854775805L,
                                9223372036854775806L,
                                9223372036854775807L
                        )
                receiveLongArray(longArray)
                r.add(Status.PASS, longArray.joinToString())

                val floatArray = floatArrayOf(1.1f, 2.2f)
                receiveFloatArray(floatArray)
                r.add(Status.PASS, floatArray.joinToString())

                val doubleArray = doubleArrayOf(1.1, 2.2)
                receiveDoubleArray(doubleArray)
                r.add(Status.PASS, doubleArray.joinToString())

                val charArray = charArrayOf('x', 'y', 'z')
                receiveCharArray(charArray)
                r.add(Status.PASS, charArray.joinToString())

                val bigInt = BigInteger("123456789012345678901234567890")
                receiveBigInteger(bigInt)
                r.add(Status.PASS, bigInt.toString())

                val bigDec = BigDecimal("3.141592653589793238462643383")
                receiveBigDecimal(bigDec)
                r.add(Status.PASS, bigDec.toString())

                val list = listOf("a", "b", "c")
                receiveList(list)
                r.add(Status.PASS, list.toString())

                val map = mapOf("key" to "value")
                receiveMap(map)
                r.add(Status.PASS, map.toString())

                val set = setOf("a", "b", "c")
                receiveSet(set)
                r.add(Status.PASS, set.toString())

                val nestedObjects =
                        arrayOf(
                                arrayOf(arrayOf("a", "b", "c"), arrayOf("d", "e", "f")),
                                arrayOf(arrayOf("g", "h", "i"), arrayOf("j", "k", "l"))
                        )

                receiveNestedObjectArray(nestedObjects)
                r.add(Status.PASS, nestedObjects.toString())

                val nestedPrimitives =
                        arrayOf(
                                arrayOf(intArrayOf(1, 2, 3), intArrayOf(4, 5, 6)),
                                arrayOf(intArrayOf(7, 8, 9), intArrayOf(10, 11, 12))
                        )

                receiveNestedPrimitivesArray(nestedPrimitives)
                r.add(Status.PASS, nestedPrimitives.toString())

                val longIntegerArray = Array(100) { it + 1 }.toIntArray()
                receiveIntArray(longIntegerArray)
                r.add(Status.PASS, longIntegerArray.toString())

                receiveEnum(Direction.NORTH)
                r.add(Status.PASS, Direction.NORTH.toString())

                r.add(Status.PASS, this.buildIntentWithFlags())

                r.add(Status.PASS, initRsaKeyPair())

                receiveNestedList(listOf(listOf("a", "b"), listOf("c", "d")))
                r.add(Status.PASS, "nested list")

                receiveOverloaded(42)
                receiveOverloaded("frooky")
                receiveOverloaded("frooky", 42)
                r.add(Status.PASS, "overloads")

                receiveStatic("static")
                r.add(Status.PASS, Secret("s3cr3t").value)

                val secretBuffer = ByteArray(6)
                fillSecret(secretBuffer)
                r.add(Status.PASS, String(secretBuffer))

                val caseBuffer = "frooky".toByteArray()
                toggleCase(caseBuffer)
                r.add(Status.PASS, String(caseBuffer))

                receiveMode(MODE_DECRYPT)
                receiveTextBytes("Hello frooky".toByteArray())
                r.add(Status.PASS, "mode and text bytes")

                receiveBundle(Bundle().apply {
                        putString("user", "alice")
                        putInt("age", 42)
                        putStringArray("roles", arrayOf("admin", "dev"))
                })
                receiveContentValues(ContentValues().apply {
                        put("name", "alice")
                        put("score", 42)
                })
                receiveClipData(ClipData.newPlainText("label", "copied secret"))
                receiveIntent(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.org")).putExtra("token", "abc123"))
                Intent.parseUri("intent:#Intent;action=android.intent.action.VIEW;end", Intent.URI_INTENT_SCHEME)
                r.add(Status.PASS, "android types")

                receiveParcelable(LabeledIntent(Intent(Intent.ACTION_SEND), "org.owasp.mastestapp", "Share", 0))
                receiveAny(sortedMapOf("b" to "2", "a" to "1"))
                receiveHeaders(Headers().apply { put("Accept", "application/json") })
                r.add(Status.PASS, "decoder resolution")

                receiveByteBuffer(ByteBuffer.wrap("frooky".toByteArray()).position(2) as ByteBuffer)
                receiveMapEntry(mapOf("token" to "abc123").entries.first())
                receiveCharSequence(StringBuilder("built ").append("text"))
                receiveLevel(Level.HIGH)
                receivePassword("s3cr3t".toCharArray())
                receiveProfile(UserProfile("alice", 42, true))
                r.add(Status.PASS, "more java types")

                receivePersistableBundle(PersistableBundle().apply { putString("user", "alice") })
                receiveLocation(Location("gps").apply {
                        latitude = 47.3769
                        longitude = 8.5417
                        accuracy = 5f
                        time = 0
                })
                receiveWebResourceRequest(ApiRequest("https://example.org/api"))
                r.add(Status.PASS, "more android types")

                r.add(Status.PASS, useCryptoTypes())

                trackEvent("button_click")
                ThirdPartySdk().flush(this)
                r.add(Status.PASS, "events tracked")

                return r.toJson()
        }
}
