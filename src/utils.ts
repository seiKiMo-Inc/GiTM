import type { PacketIds } from "@app/types";

/**
 * Parses a packet sent by the client.
 * @param packet The packet to parse.
 */
export function readPacket(packet: Buffer): Buffer {
    let i: number = 0, tokenSizeTotal: number = 0;
    const messages: Buffer[] = [];

    while (i < packet.length) {
        const convId = packet.readUInt32BE(i);
        const remainingHeader = packet.subarray(i + 8, i + 28);
        const contentLen = packet.readUInt32LE(i + 24);
        const content = packet.subarray(i + 28, i + 28 + contentLen);

        const formattedMessage = Buffer.alloc(24 + contentLen);
        formattedMessage.writeUInt32BE(convId, 0);
        remainingHeader.copy(formattedMessage, 4);
        content.copy(formattedMessage, 24);
        i += 28 + contentLen;
        tokenSizeTotal += 4;
        messages.push(formattedMessage);
    }

    return Buffer.concat(messages, packet.length - tokenSizeTotal);
}

/**
 * Parses a packet into a basic protocol buffer.
 * Removes the 2 byte header and 2 byte footer.
 * Removes the length of the packet.
 * Removes the packet head.
 * @param packet The packet to parse.
 */
export function parsePacket(packet: Buffer): Buffer {
    let sliced = Buffer.from(packet.slice(10));
    sliced = sliced.slice(0, sliced.byteLength - 4);
    sliced = sliced.slice(packet.readUint8(5));
    return sliced.slice(packet.readUint8(6), sliced.length);
}

/**
 * Performs an XOR operation on a packet.
 * @param packet The packet to XOR.
 * @param key The key to XOR with.
 */
export function xor(packet: Buffer, key: Buffer): void {
    for (let i = 0; i < packet.length; i++) {
        packet[i] ^= key[i % key.length];
    }
}

/**
 * Reads the packet IDs from a CSV file.
 * @param data The CSV file to read.
 * @param backwards Whether to read the file backwards.
 */
export function readPacketIds(data: string, backwards = false): PacketIds {
    // Split the data into lines.
    const lines = data.split("\n");
    // Parse the lines into an object.
    const object: PacketIds = {};
    lines.forEach(line => {
        // Parse the line.
        const [name, id] = line.split(",");
        // Add the line to the object.
        if (backwards)
            object[id] = name;
        else
            object[name] = id;
    });

    return object;
}