import type { PacketIds } from "@app/types";
import { Protocol } from "@app/types";
import { protocol } from "@app/constants";

import * as protobuf from "protobufjs";

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
    const metadataSize = packet.readUInt16BE(4);
    const dataSize = packet.readUInt32BE(6);
    return packet.slice(10 + metadataSize, 10 + metadataSize + dataSize);
}

/**
 * Formats a protocol buffer into a packet.
 * @param packet The packet to format.
 * @param token The token to use.
 */
export function formatPacket(packet: Buffer, token: number): Buffer {
    const data1 = Buffer.from(packet);
    const messages: Buffer[] = [];

    let i = 0; while (i < data1.length) {
        let conv = data1.readUInt32BE(i);
        let contentLen = data1.readUInt32LE(i + 20);
        let newStart = Buffer.alloc(8);
        newStart.writeUInt32BE(conv, 0);
        newStart.writeUInt32BE(token, 4);

        let slice = data1.subarray(i + 4, i + 24 + contentLen);
        let awa = Buffer.concat([newStart, slice]);
        messages.push(awa);
        i += contentLen + 24;
    }

    return Buffer.concat(messages);
}

/**
 * Encodes a packet into a usable format.
 * @param packet The packet to encode.
 * @param id The ID of the packet.
 * @param key The key to encrypt with.
 */
export async function encodePacket(packet: Buffer, id: number, key: Buffer): Promise<Buffer> {
    const packetHead = await toProto({ sent_ms: Date.now() }, "PacketHead", Protocol.REL3_2);
    const footer = Buffer.from(0x89AB.toString(16), "hex");
    const metadata = Buffer.alloc(10);

    // Prepare the packet metadata.
    metadata.writeUint16BE(0x4567, 0); // Packet header
    metadata.writeUInt16BE(id, 2); // Packet ID
    metadata.writeUInt8(packetHead.length, 5); // Packet head length
    metadata.writeUInt16BE(packet.length, 8); // Packet data length

    try {
        const encoded = Buffer.concat([
            metadata, packetHead, packet, footer
        ], metadata.length + packetHead.length + packet.length + footer.length);

        xor(encoded, key); // Encrypt the packet.
        return encoded; // Return the encoded packet.
    } catch (err) {
        console.error(err); return null;
    }
}

/**
 * Splits a packet into multiple packets.
 * @param data The packet to split.
 * @param length The length of each packet.
 */
export function splitPackets(data: Buffer, length = 28): Buffer[] {
    const buffers: Buffer[] = [];
    let i = 0; while (i < data.length) {
        let contentLen = data.readUInt32BE(i + length - 4)
        let sliced = data.slice(i, i + length + contentLen)
        buffers.push(sliced);
        i += length + contentLen
    }

    return buffers;
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

/**
 * Translates a packet to a JSON object.
 * @param buffer The packet to translate.
 * @param name The name of the packet.
 * @param version The protocol to use.
 */
export async function fromProto(
    buffer: Buffer,
    name: string,
    version: Protocol
): Promise<any> {
    try {
        // Find the definition for the packet.
        const protoRoot = protocol.root[version];
        const file = `${protoRoot}/${name}.proto`;
        const definition = await protobuf.load(file);

        // Find the message for the packet.
        const message = definition.lookupType(name);
        return message ? message.decode(buffer) : null;
    } catch (err) {
        console.error(err); return null;
    }
}

/**
 * Translates a JSON object to a packet.
 * @param buffer The packet to translate.
 * @param name The name of the packet.
 * @param version The protocol to use.
 */
export async function toProto(
    buffer: any,
    name: string,
    version: Protocol
): Promise<any> {
    try {
        // Find the definition for the packet.
        const protoRoot = protocol.root[version];
        const file = `${protoRoot}/${name}.proto`;
        const definition = await protobuf.load(file);

        // Find the message for the packet.
        const message = definition.lookupType(name);
        if (message == undefined) return null;

        // Encode the message using the packet.
        const instance = message.create(buffer);
        return message.encode(instance).finish();
    } catch (err) {
        console.error(err); return null;
    }
}