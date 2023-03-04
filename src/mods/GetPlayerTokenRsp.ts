import type { Buffer, Long } from "protobufjs";
import { Client, MT19937_64 } from "@app/types";

type GetPlayerTokenRsp = {
    retcode: number;
    securityCmdBuffer: Buffer;
    secretKeySeed: Long;
    uid: number;
};

/**
 * Packet modification handler for 'GetPlayerTokenRsp'.
 * @param object The packet object. Before translation.
 * @param client The client instance sending the packet.
 */
export default async function(
    object: GetPlayerTokenRsp,
    client: Client
): Promise<void> {
    // Get the XOR key seed from the packet.
    const seed = BigInt(object.secretKeySeed.toString());
    // Generate an XOR key.
    const generator = new MT19937_64();
    generator.seed(seed);
    generator.seed(generator.next());
    generator.next();

    // Create the key.
    const key = Buffer.alloc(0x1000);
    for (let i = 0; i < 0x1000; i += 8) {
        key.writeBigUint64BE(generator.next(), i);
    }

    // Save the key.
    client.post = true;
    client.server.encryptKey = key;
}