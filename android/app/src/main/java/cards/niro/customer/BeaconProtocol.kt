package cards.niro.customer

import android.os.ParcelUuid

/**
 * The Niro beacon format. A beacon is a Bluetooth LE advertisement that carries one service-data block:
 * magic byte 'N' followed by the cafe's 8-character beacon code (ASCII). Any phone, tablet or small
 * hardware beacon that sends this is recognised by the Niro app on every nearby Android phone.
 */
object BeaconProtocol {
    /** "niro" in ASCII (6e 69 72 6f) inside the standard Bluetooth base UUID. */
    val SERVICE_UUID: ParcelUuid = ParcelUuid.fromString("6e69726f-0000-1000-8000-00805f9b34fb")
    const val MAGIC: Byte = 0x4E
    private val CODE = Regex("^[A-Z2-9]{8}$")

    fun payload(code: String): ByteArray = byteArrayOf(MAGIC) + code.toByteArray(Charsets.US_ASCII)

    fun parse(data: ByteArray?): String? {
        if (data == null || data.size != 9 || data[0] != MAGIC) return null
        val code = String(data, 1, 8, Charsets.US_ASCII)
        return if (CODE.matches(code)) code else null
    }
}
